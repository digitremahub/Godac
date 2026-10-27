import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dansLePerimetre } from "@/lib/roles/perimetre";
import { rangJour } from "@/lib/planning/semaine";
import { SEMAINES_A_L_AVANCE, estSemainePreparable, instantParis } from "@/lib/planning/semaines-auto";
import { genererSemaine } from "@/lib/planning/semaines-auto-serveur";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  semaine_debut: z.string().date().refine((d) => rangJour(d) === 0, "La semaine commence un lundi."),
});

/**
 * « Générer le planning de la semaine du … » : prépare à la demande une semaine à
 * venir (la suivante et jusqu'à 8 semaines plus loin) pour UN service, avec les mêmes
 * règles que la génération du jeudi (lib/planning/semaines-auto-serveur.ts › genererSemaine) :
 * rien n'est écrasé, seules les cases vides sont remplies, tournées fermées non
 * recopiées, absents « à remplacer », lignes NON publiées (invisibles des chauffeurs,
 * sans notification pour eux). La semaine recopiée est la plus proche avant la cible
 * qui a des affectations (4 semaines en arrière au plus). Ligne de suivi
 * genere_par = 'manuel' ; audit planning_semaine_generee (mode « manuel »).
 * Personne n'est notifié, sauf pour la semaine suivante (alerte habituelle, elle part
 * toute seule le vendredi 17 h). Direction et exploitation : toute l'organisation ;
 * manager : son service ; jamais le chauffeur ni le comptable.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "exploitation", "manager"], modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { service_id, semaine_debut } = parsed.data;
  if (!estSemainePreparable(semaine_debut, instantParis(new Date()).jour)) {
    return NextResponse.json({ error: `Seule une semaine à venir, dans les ${SEMAINES_A_L_AVANCE} prochaines semaines, peut être préparée.` }, { status: 400 });
  }

  const { data: liens } = await g.supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
  if (!dansLePerimetre(appUser.role, ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id), service_id)) {
    return NextResponse.json({ error: "Ce service ne fait pas partie de vos services." }, { status: 403 });
  }

  let admin: ReturnType<typeof createAdminSupabaseClient>;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    return NextResponse.json({ error: "Génération indisponible (configuration du serveur)." }, { status: 500 });
  }
  try {
    const bilan = await genererSemaine(admin, appUser.organization_id, { lundi: semaine_debut, serviceId: service_id, manuel: true, userId: appUser.id });
    if (bilan.migrationManquante) return NextResponse.json({ error: bilan.message }, { status: 503 });
    const s = bilan.services[0];
    if (!s) return NextResponse.json({ error: "Service introuvable dans votre organisation, ou sans tournées (pôle bureau)." }, { status: 404 });
    if (s.statut === "erreur") return NextResponse.json({ error: s.message ?? "Génération impossible." }, { status: 500 });
    if (s.statut === "publiee") return NextResponse.json({ error: s.message, code: "deja_publiee" }, { status: 409 });
    if (s.statut === "deja") return NextResponse.json({ error: "Cette semaine est déjà préparée : ouvrez-la pour la compléter ou la confirmer.", code: "deja_preparee" }, { status: 409 });
    if (s.statut === "rien") return NextResponse.json({ error: s.message ?? "Rien à générer.", code: "rien_a_copier" }, { status: 422 });
    return NextResponse.json({ ok: true, statut: s.statut, cases_creees: s.creees ?? 0, a_remplacer: s.resume?.a_remplacer ?? 0, source: s.source ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Génération impossible." }, { status: 500 });
  }
}
