import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { estPoleBureau } from "@/lib/organization/poles";
import { voitToutLOrganisation } from "@/lib/roles/perimetre";
import { periodePublication } from "@/lib/planning/publication";
import { publierSemaines } from "@/lib/planning/publication-serveur";

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
 * Le travail est fait par lib/planning/publication-serveur.ts › publierSemaines,
 * aussi utilisé par « Confirmer et envoyer aux chauffeurs » et l'envoi
 * automatique du vendredi. Validation par le client de la session (RLS : un
 * manager publie ses services) ; alertes et nettoyage des changements par le
 * client service role, alerts n'ayant pas de policy d'insertion pour les
 * clients — le rôle est vérifié au-dessus. Publier une semaine générée
 * automatiquement la rend visible des chauffeurs (planning_semaines_auto).
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

  const r = await publierSemaines({ db: supabase, organizationId: appUser.organization_id, validateurId: appUser.id, serviceIds, debut: periode.debut, fin: periode.fin, mode: "manuel" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ sent: r.sent, debut: r.debut, fin: r.fin, suivi: r.suivi });
}
