import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer } from "@/lib/usage/consommer";
import { cleAdresse, horairesDesAdresses, listesDeTournee, moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { sequenceParListes } from "@/lib/colis/listes";
import { fenetresArret, heureDepart, instantParis, lireHeure, type Fenetres } from "@/lib/colis/horaires";
import { type Point } from "@/lib/colis/optimisation";
import { rechercherEtEnregistrerHoraires } from "@/lib/colis/horaires-internet";
import { matriceRoutiere } from "@/lib/colis/matrice";
import { ordonnerListesGlobalement } from "@/lib/colis/tournee-globale";

export const maxDuration = 60;

const bodySchema = z.object({
  run_id: z.string().uuid(),
  /** Position actuelle du chauffeur : réoptimiser en cours de route à partir d'ici. */
  depuis: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
  /** Heure de départ (« 07:30 ») à utiliser à la place de celle de la tournée. */
  heure_depart: z
    .string()
    .refine((v) => lireHeure(v) !== null)
    .nullable()
    .optional(),
});

/**
 * Calcule l'ordre de passage des arrêts restants. Les arrêts déjà livrés
 * gardent leur place en tête ; chaque liste est optimisée à son tour
 * (enchaînée à la précédente, retour au dépôt après la dernière) ; les
 * adresses non localisées passent à la fin de leur liste.
 *
 * Horaires d'ouverture (annuaire des adresses pro, créneau ponctuel de
 * l'arrêt) : heures de passage simulées depuis le départ (maintenant en
 * cours de route, sinon l'heure de départ prévue, 08:00 par défaut) ; les
 * adresses fermées ce jour-là ou injoignables avant la fermeture passent
 * en fin de liste. Renvoie l'heure de passage estimée de chaque arrêt et
 * le résumé (km avant / après, hors horaires, fermés).
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  // Quota « route_optimization » : prix 0 € et volume large pour les
  // formules classiques ; plafond strict pour l'essai GO Navigation.
  const quota = await consommer(createAdminSupabaseClient(), appUser.organization_id, appUser.id, "route_optimization");
  if (!quota.ok) return NextResponse.json({ error: quota.raison, code: "QUOTA_ATTEINT" }, { status: 429 });

  const [{ data: stops }, listes] = await Promise.all([
    supabase.from("delivery_stops").select("id, list_id, lat, lng, status, position, address, window_start, window_end").eq("run_id", run.id).order("position"),
    listesDeTournee(supabase, run.id),
  ]);
  const arrets = (stops ?? []) as { id: string; list_id: string | null; lat: number | null; lng: number | null; status: string; position: number; address: string; window_start: string | null; window_end: string | null }[];
  const depot: Point | null = run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
  const depart = parsed.data.depuis ?? depot;
  const enRoute = Boolean(parsed.data.depuis) || run.status === "in_progress";
  const pointsRoutage: Point[] = [
    ...(depart ? [depart] : []),
    ...arrets.filter((s) => s.status === "pending" && s.lat !== null && s.lng !== null).map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })),
    ...(depot ? [depot] : []),
  ];
  // Matrice des km routiers réels (OSRM, découpée et mise en cache) ; repli à vol d'oiseau × 1,3.
  const matrice = await matriceRoutiere(pointsRoutage);
  const distance = matrice.distance;
  const retour = run.return_to_start && !parsed.data.depuis;

  // Ordre global des villages : toutes les listes s'enchaînent dans un seul
  // sens de tournée (lib/colis/tournee-globale.ts).
  const { listes: nouvelOrdre } = ordonnerListesGlobalement(arrets, listes, depart, retour, distance);
  await Promise.all(
    nouvelOrdre.map((l) => (listes.find((x) => x.id === l.id)?.position === l.position ? null : supabase.from("delivery_lists").update({ position: l.position }).eq("id", l.id))),
  );

  // Adresses pro jamais examinées (ajoutées avant cette fonction, import…) :
  // recherche des horaires sur internet, enregistrés dans l'annuaire.
  const aExaminer = await supabase
    .from("delivery_stops")
    .select("id, address, recipient, lat, lng, kind, business_name")
    .eq("run_id", run.id)
    .eq("status", "pending")
    .is("hours_lookup_at", null)
    .limit(40);
  if (!aExaminer.error && aExaminer.data?.length) {
    await rechercherEtEnregistrerHoraires(supabase, appUser.organization_id, appUser.id, aExaminer.data as any[], { budgetMs: 15000 }).catch(() => undefined);
  }

  // Heure de départ et jour (Paris) des horaires à appliquer.
  const { jour, minute } = heureDepart({ ...run, planned_start: parsed.data.heure_depart ?? run.planned_start }, new Date(), enRoute);
  const fiches = await horairesDesAdresses(
    supabase,
    appUser.organization_id,
    arrets.filter((s) => s.status === "pending").map((s) => s.address),
  );
  const fenetres = new Map<string, Fenetres>(
    arrets.map((s) => [s.id, fenetresArret({ semaine: fiches.get(cleAdresse(s.address))?.weekly_schedule, debut: s.window_start, fin: s.window_end }, jour)]),
  );

  const r = sequenceParListes(arrets, nouvelOrdre, depart, retour, {
    debut: minute,
    fenetres: (id) => fenetres.get(id) ?? null,
    distance,
  });

  // Positions globales et contiguës (0, 1, 2…) dans l'ordre calculé.
  await Promise.all(r.sequence.map((id, position) => supabase.from("delivery_stops").update({ position }).eq("id", id)));
  await supabase.from("delivery_runs").update({ optimized_at: new Date().toISOString() }).eq("id", run.id);

  const iso = (m: number) => instantParis(jour, m).toISOString();
  return NextResponse.json({
    kmAvant: Math.round(r.kmAvant * 10) / 10,
    kmApres: Math.round(r.kmApres * 10) / 10,
    sansGps: r.sansGps,
    depart: iso(minute),
    finEstimee: r.fin === null ? null : iso(r.fin),
    /** Arrêts avec horaires (annuaire ou créneau) parmi les restants. */
    avecHoraires: arrets.filter((s) => s.status === "pending" && fenetres.get(s.id) !== null).length,
    horsHoraires: r.horsHoraires,
    fermes: r.fermes,
    impossibles: r.impossibles,
    distanceRoutiere: !matrice.estimation(),
    passages: Object.fromEntries(
      Object.entries(r.passages).map(([id, p]) => [id, { arrivee: iso(p.arrivee), attenteMin: Math.round(p.attente), statut: p.statut }]),
    ),
  });
}
