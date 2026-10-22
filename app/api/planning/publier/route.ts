import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/planning/dates";
import { minuitParis } from "@/lib/ticpe/export";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { estPoleBureau } from "@/lib/organization/poles";
import { voitToutLOrganisation } from "@/lib/roles/perimetre";
import { cleSemaine, destinatairesPublication, messagePublication, periodePublication, type AffectationPubliee, type ChangementAPublier } from "@/lib/planning/publication";

const bodySchema = z.object({
  /** Période affichée (jour, semaine ou mois) : la publication porte sur ses semaines entières. */
  debut: z.string().date(),
  fin: z.string().date(),
  service_id: z.string().uuid().optional(),
});

/**
 * « Publier aux chauffeurs » (lib/planning/publication.ts) : UNE
 * notification par chauffeur concerné, avec le récapitulatif de ses
 * tournées des semaines publiées (et les tournées qu'on lui a retirées).
 * - pose planning_validations pour chaque service × semaine : la semaine
 *   est publiée, les changements suivants sont suivis (migration
 *   20261030000003_planning_publication.sql) ;
 * - sans cette migration (planning_changements absente) : récapitulatif à
 *   tous les chauffeurs de la période, comme l'ancien « Valider et envoyer ».
 * Validation par le client de la session (RLS : un manager publie ses
 * services) ; alertes et nettoyage des changements par le client service
 * role, alerts n'ayant pas de policy d'insertion pour les clients (comme
 * app/api/cron/weekly-planning-digest) — le rôle est vérifié au-dessus.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!["direction", "manager", "exploitation"].includes(appUser.role)) {
    return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d’équipe peut publier le planning." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const periode = periodePublication(parsed.data.debut, parsed.data.fin);
  if (periode.lundis.length > 6) return NextResponse.json({ error: "Publiez au plus six semaines à la fois." }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // Services publiés : celui choisi, sinon tous ceux (d'exploitation) de la personne.
  let serviceIds: string[];
  if (parsed.data.service_id) {
    serviceIds = [parsed.data.service_id];
  } else if (voitToutLOrganisation(appUser.role)) {
    const { data } = await supabase.from("services").select("id, pole").eq("organization_id", appUser.organization_id);
    serviceIds = ((data ?? []) as { id: string; pole: string | null }[]).filter((s) => !estPoleBureau(s.pole)).map((s) => s.id);
  } else {
    const { data } = await supabase.from("user_services").select("services(id, pole)").eq("user_id", appUser.id);
    serviceIds = ((data ?? []) as any[]).map((r) => r.services).filter((s) => s && !estPoleBureau(s.pole)).map((s) => s.id as string);
  }
  if (!serviceIds.length) return NextResponse.json({ error: "Aucun service à publier." }, { status: 400 });

  const depuis = minuitParis(periode.debut);
  const avant = minuitParis(addDays(periode.fin, 1));
  const [{ data: validations }, { data: entrees, error: entreesError }, changementsLus] = await Promise.all([
    supabase.from("planning_validations").select("service_id, week_start").in("service_id", serviceIds).in("week_start", periode.lundis),
    supabase
      .from("planning_entries")
      .select("driver_id, service_id, tour_number, start_at, status, vehicles(registration)")
      .in("service_id", serviceIds)
      .eq("status", "planned")
      .not("driver_id", "is", null)
      .gte("start_at", depuis)
      .lt("start_at", avant)
      .order("start_at"),
    supabase
      .from("planning_changements")
      .select("id, driver_id, service_id, tour_number, start_at, nature")
      .eq("organization_id", appUser.organization_id)
      .in("service_id", serviceIds)
      .gte("start_at", depuis)
      .lt("start_at", avant),
  ]);
  if (entreesError) return NextResponse.json({ error: entreesError.message }, { status: 500 });
  if (changementsLus.error && !estSchemaManquant(changementsLus.error)) return NextResponse.json({ error: changementsLus.error.message }, { status: 500 });
  const changements = changementsLus.error ? null : ((changementsLus.data ?? []) as ChangementAPublier[]);

  const publiees = new Set(((validations ?? []) as { service_id: string; week_start: string }[]).map((v) => cleSemaine(v.service_id, v.week_start)));
  const destinataires = destinatairesPublication({ affectations: (entrees ?? []) as unknown as AffectationPubliee[], changements, publiees });

  // 1. Semaines publiées (le trigger suit désormais leurs changements).
  const lignes = serviceIds.flatMap((service_id) =>
    periode.lundis.map((week_start) => ({ organization_id: appUser.organization_id, service_id, week_start, validated_at: new Date().toISOString(), validated_by: appUser.id })),
  );
  const { error: validationError } = await supabase.from("planning_validations").upsert(lignes, { onConflict: "organization_id,service_id,week_start" });
  if (validationError) return NextResponse.json({ error: validationError.message }, { status: 500 });

  // 2. Une notification par chauffeur, 3. changements publiés effacés.
  if (destinataires.length || changements?.length) {
    let admin: ReturnType<typeof createAdminSupabaseClient>;
    try {
      admin = createAdminSupabaseClient();
    } catch {
      return NextResponse.json({ error: "Envoi des notifications indisponible (configuration du serveur)." }, { status: 500 });
    }
    if (destinataires.length) {
      const { error } = await admin.from("alerts").insert(
        destinataires.map((d) => ({
          organization_id: appUser.organization_id,
          type: "planning_validated",
          severity: "info",
          message: messagePublication(d),
          related_table: "planning_entries",
          recipient_user_id: d.driverId,
        })),
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (changements?.length) {
      const { error } = await admin.from("planning_changements").delete().in("id", changements.map((c) => c.id));
      if (error) console.warn("[planning/publier] Changements publiés non effacés", error.message);
    }
  }

  return NextResponse.json({ sent: destinataires.length, debut: periode.debut, fin: periode.fin, suivi: changements !== null });
}
