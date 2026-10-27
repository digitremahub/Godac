import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";
import { parisCalendarDate } from "@/lib/planning/dates";
import { libererFicheAncienChauffeur } from "@/lib/planning/fiche-reaffectation";
import { ficheApresAffectation, questionAvantAffectation } from "@/lib/colis/fiche-a-l-affectation";
import { refusSiFermee } from "@/lib/planning/ouverture-serveur";
import { noterModificationPlanning } from "@/lib/planning/suivi-auto-serveur";
import { messageRefusAffectation, verrouDe } from "@/lib/planning/fusion-verrou";
import { cloreAlertesFusion, verrousDeLaPeriode } from "@/lib/planning/fusion-verrou-serveur";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { libelleJour } from "@/lib/planning/semaine";

const patchSchema = z.object({
  start_at: z.string().datetime().optional(),
  service_id: z.string().uuid().optional(),
  /** null : retirer le chauffeur, l'affectation reste « à remplacer ». */
  driver_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid().optional(),
  tour_number: z.string().min(1).optional(),
  /** Réponse à la question « fiches colis séparées ou reliées » (409 choix_requis). */
  regroupement: z.enum(["separee", "reliee"]).optional(),
});

/**
 * Reschedule/reassign a still-"planned" entry — this is what the
 * planning grid's drag-to-move and edit actions call. Scoped to
 * status='planned' so a manager can't retroactively edit a tour the
 * driver has already started or finished from here.
 *
 * Tournée d'origine d'une fusion (lib/planning/fusion-verrou.ts) : on ne lui
 * place pas de chauffeur et on n'y déplace pas d'affectation (409 explicite).
 * Retirer le chauffeur d'un doublon reste possible.
 *
 * Changement de chauffeur (glisser, retirer) : la fiche colis préparée pour
 * l'ancien chauffeur lui est retirée (lib/planning/fiche-reaffectation.ts) ;
 * tournée colis active, le nouveau chauffeur passe par la même question
 * « séparées ou reliées » que POST /api/planning/entries, puis sa fiche est
 * préparée (jour même ou à venir).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { regroupement, ...champs } = parsed.data;

  // Tournée fermée (migration 20261105000001) : plus de changement d'affectation tant qu'elle n'est pas rouverte.
  const fermee = await refusSiFermee(appUser.organization_id, id, "encadrement");
  if (fermee) return NextResponse.json({ error: fermee }, { status: 423 });

  const supabase = await createServerSupabaseClient();

  // Case verrouillée par une fusion : ni chauffeur placé, ni affectation déplacée vers elle.
  if (champs.driver_id || champs.start_at || champs.service_id || champs.tour_number) {
    const { data: courante } = await supabase.from("planning_entries").select("service_id, tour_number, driver_id, start_at").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (courante) {
      const service = champs.service_id ?? (courante.service_id as string);
      const tournee = champs.tour_number ?? (courante.tour_number as string);
      const debut = champs.start_at ?? (courante.start_at as string);
      const jour = parisCalendarDate(debut);
      const chauffeurFinal = champs.driver_id !== undefined ? champs.driver_id : (courante.driver_id as string | null);
      const deplacee = service !== courante.service_id || tournee !== courante.tour_number || jour !== parisCalendarDate(courante.start_at as string);
      if (champs.driver_id || (deplacee && chauffeurFinal)) {
        const { verrous } = await verrousDeLaPeriode(supabase, appUser.organization_id, service, jour, jour);
        const verrou = verrouDe(verrous, service, tournee, jour);
        if (verrou) return NextResponse.json({ error: messageRefusAffectation(verrou, libelleJour), code: "tournee_fusionnee", hote: verrou.hoteNumero }, { status: 409 });
      }
    }
  }

  const colis = g.modules.has("route_optimizer");
  let avertissementFiche: string | null = null;
  let changeDeChauffeur = false;
  let ancienChauffeur: string | null = null;
  if (champs.driver_id !== undefined) {
    const { data: avant } = await supabase.from("planning_entries").select("driver_id, start_at, status").eq("id", id).maybeSingle();
    if (!avant || avant.status !== "planned") return NextResponse.json({ error: "Affectation introuvable ou déjà démarrée." }, { status: 404 });
    changeDeChauffeur = avant.driver_id !== champs.driver_id;
    ancienChauffeur = avant.driver_id ?? null;
    if (changeDeChauffeur && champs.driver_id && colis) {
      const date = parisCalendarDate(champs.start_at ?? (avant.start_at as string));
      const choix = await questionAvantAffectation(supabase, { id: champs.driver_id, organization_id: appUser.organization_id }, date, regroupement, "planning/entries/patch");
      if (choix) return NextResponse.json({ choix_requis: true, ...choix }, { status: 409 });
    }
    if (changeDeChauffeur && avant.driver_id) avertissementFiche = await libererFicheAncienChauffeur(supabase, id);
  }

  // Ligne avant déplacement : la semaine d'origine d'une affectation glissée vers une autre semaine est modifiée aussi.
  const { data: avantDeplacement } = champs.start_at || champs.service_id ? await supabase.from("planning_entries").select("service_id, start_at").eq("id", id).maybeSingle() : { data: null };

  const { data, error } = await supabase
    .from("planning_entries")
    .update(champs)
    .eq("id", id)
    .eq("status", "planned")
    .select("id, organization_id, service_id, driver_id, vehicle_id, tour_number, start_at, status, created_at")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Une affectation existe déjà pour ce service, ce numéro de tournée et cette date/heure." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Affectation introuvable ou déjà démarrée." }, { status: 404 });
  await noterModificationPlanning(appUser.organization_id, [
    { serviceId: data.service_id, startAt: data.start_at },
    ...(avantDeplacement ? [{ serviceId: avantDeplacement.service_id as string, startAt: avantDeplacement.start_at as string }] : []),
  ]);

  const warning = data.driver_id
    ? await warnIfDriverDoubleBooked(supabase, {
        organizationId: appUser.organization_id,
        driverId: data.driver_id,
        startAt: data.start_at,
        excludeEntryId: data.id,
      })
    : null;

  let ficheWarning: string | null = null;
  if (changeDeChauffeur && data.driver_id && colis) {
    const r = await ficheApresAffectation(supabase, { id: data.driver_id, organization_id: appUser.organization_id }, data, parisCalendarDate(data.start_at), regroupement, "planning/entries/patch");
    ficheWarning = r.warning;
  }

  if (changeDeChauffeur) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "planning_affectation", targetTable: "planning_entries", targetId: data.id, details: { avant: ancienChauffeur, apres: data.driver_id } });
  }
  return NextResponse.json({ id: data.id, warning: [warning, avertissementFiche, ficheWarning].filter(Boolean).join(" ") || null });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g2 = await garderApi({ modules: ["planning"] });
  if (!g2.ok) return g2.reponse;
  const fermee = await refusSiFermee(g2.appUser.organization_id, id, "encadrement");
  if (fermee) return NextResponse.json({ error: fermee }, { status: 423 });
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("planning_entries")
    .delete()
    .eq("id", id)
    .eq("status", "planned")
    .select("id, service_id, start_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Affectation introuvable ou déjà démarrée." }, { status: 404 });
  await noterModificationPlanning(g2.appUser.organization_id, [{ serviceId: data.service_id as string, startAt: data.start_at as string }]);
  // Ligne hôte d'une fusion supprimée : ses alertes « fusionnée avec… » n'ont plus d'objet (la fusion part avec elle).
  try {
    await cloreAlertesFusion(createAdminSupabaseClient(), g2.appUser.organization_id, id);
  } catch {
    // Jamais bloquant.
  }
  await journaliser({ organizationId: g2.appUser.organization_id, userId: g2.appUser.id, action: "planning_tournee_retiree", targetTable: "planning_entries", targetId: id });
  return NextResponse.json({ ok: true });
}
