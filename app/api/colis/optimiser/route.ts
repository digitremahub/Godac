import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer } from "@/lib/usage/consommer";
import { cleAdresse, depotDuService, ecrireExtremitesRun, horairesDesAdresses, lireExtremitesRun, listesDeTournee, moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { contraintesListes, resoudreExtremites, schemaArrivee, schemaDepart } from "@/lib/colis/extremites";
import { fenetresArret, heureDepart, instantParis, lireHeure, type Fenetres } from "@/lib/colis/horaires";
import { memePoint, type Point } from "@/lib/colis/optimisation";
import { rechercherEtEnregistrerHoraires } from "@/lib/colis/horaires-internet";
import { matriceRoutiere } from "@/lib/colis/matrice";
import { ordonnerListesGlobalement } from "@/lib/colis/tournee-globale";
import { estListeReportee } from "@/lib/colis/villages";
import { sequenceParListes, type ResultatSequence } from "@/lib/colis/listes";
import { ecrirePreferenceSens, lirePreferenceSens, runPourSens, sensDeLaTournee } from "@/lib/colis/sens-serveur";
import { MODES_SENS, biaisSansRisque, libelleSens, referenceSens, type ModeSens } from "@/lib/colis/sens-tournee";
import { dureeServicePrevue } from "@/lib/colis/fiche-client";

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
  /** Départ / arrivée choisis dans « Optimiser l'ordre » ; absents : choix mémorisé sur la tournée. */
  depart: schemaDepart.nullable().optional(),
  arrivee: schemaArrivee.nullable().optional(),
  /** « proche » : recalcul en cours de route, prochaine adresse la plus proche depuis la position (défaut : plus court trajet). */
  strategie: z.enum(["optimal", "proche"]).optional(),
  /** false : départ / arrivée utilisés pour ce calcul seulement, sans modifier le choix mémorisé de la tournée (optimisation ponctuelle depuis ma position ou une adresse). */
  memoriser: z.boolean().optional(),
  /**
   * Sens de la tournée (lib/colis/sens-tournee.ts) : « habituel » privilégie l'ordre dans lequel les
   * secteurs sont d'ordinaire parcourus, « inverse » le prend à l'envers, « libre » n'en tient pas compte.
   * Absent : le choix mémorisé (habituel par défaut dès qu'une habitude existe). Un choix explicite est
   * mémorisé pour la prochaine fois, sauf si `memoriser` vaut false.
   */
  sens: z.enum(MODES_SENS as unknown as [ModeSens, ...ModeSens[]]).optional(),
});

/**
 * Calcule l'ordre de passage des arrêts restants. Les arrêts déjà livrés
 * gardent leur place en tête ; chaque liste est optimisée à son tour
 * (enchaînée à la précédente, retour au dépôt après la dernière) ; les
 * adresses non localisées passent à la fin de leur liste.
 *
 * Départ et arrivée (lib/colis/extremites.ts) : le dépôt, la position du
 * chauffeur, une adresse ou un arrêt de la tournée au départ ; retour au
 * dépôt, même point, une adresse, un arrêt ou rien à l'arrivée. L'arrêt
 * choisi au départ est le 1er, celui de l'arrivée le dernier ; l'ordre des
 * autres est optimisé entre les deux, trajets depuis le départ et vers
 * l'arrivée compris. Le choix est mémorisé sur la tournée.
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
  const [{ data: stops }, listes, memorise] = await Promise.all([
    supabase.from("delivery_stops").select("id, list_id, lat, lng, status, position, address, window_start, window_end").eq("run_id", run.id).order("position"),
    listesDeTournee(supabase, run.id),
    lireExtremitesRun(supabase, run.id),
  ]);
  const tous = (stops ?? []) as { id: string; list_id: string | null; lat: number | null; lng: number | null; status: string; position: number; address: string; window_start: string | null; window_end: string | null }[];
  // Adresses reportées au lancement (villages décochés) : hors optimisation, numérotées à la fin.
  const idsReportees = new Set(listes.filter(estListeReportee).map((l) => l.id));
  const arrets = tous.filter((s) => !(s.list_id && idsReportees.has(s.list_id)));
  const reportes = tous.filter((s) => s.list_id && idsReportees.has(s.list_id));
  // Dépôt de la tournée, sinon dépôt du service du chauffeur / de l'organisation.
  let depot: Point | null = run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
  if (!depot) {
    const trouve = (await depotDuService(supabase, appUser, run.service_id).catch(() => null)) as { label: string; lat: number | string; lng: number | string } | null;
    if (trouve) depot = { lat: Number(trouve.lat), lng: Number(trouve.lng) };
  }
  const choixDepart = parsed.data.depart !== undefined ? parsed.data.depart : memorise.depart;
  const choixArrivee = parsed.data.arrivee !== undefined ? parsed.data.arrivee : memorise.arrivee;
  const ext = resoudreExtremites({
    depart: choixDepart,
    arrivee: choixArrivee,
    depot,
    position: parsed.data.depuis ?? null,
    arrets,
    retourParDefaut: run.return_to_start,
  });
  if (ext.erreur) return NextResponse.json({ error: ext.erreur }, { status: 422 });
  const liste = contraintesListes(arrets, listes, ext.premierId, ext.dernierId);
  if (liste.erreur) return NextResponse.json({ error: liste.erreur }, { status: 422 });

  // Quota « route_optimization » : prix 0 € et volume large pour les
  // formules classiques ; plafond strict pour l'essai GO Navigation.
  const quota = await consommer(createAdminSupabaseClient(), appUser.organization_id, appUser.id, "route_optimization");
  if (!quota.ok) return NextResponse.json({ error: quota.raison, code: "QUOTA_ATTEINT" }, { status: 429 });

  // Choix mémorisé sur la tournée (sans effet tant que la migration n'est pas appliquée).
  if (parsed.data.memoriser !== false && (parsed.data.depart !== undefined || parsed.data.arrivee !== undefined)) {
    await ecrireExtremitesRun(supabase, run.id, { depart: choixDepart, arrivee: choixArrivee }).catch(() => false);
  }

  const depart = ext.depart;
  const enRoute = Boolean(parsed.data.depuis) || run.status === "in_progress";
  const pointsRoutage: Point[] = [
    ...(depart ? [depart] : []),
    ...arrets.filter((s) => s.status === "pending" && s.lat !== null && s.lng !== null).map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })),
    ...(ext.fin ? [ext.fin] : []),
  ];
  // Matrice des km routiers réels (OSRM, découpée et mise en cache) ; repli à vol d'oiseau × 1,3.
  const matrice = await matriceRoutiere(pointsRoutage);
  const distance = matrice.distance;
  const retour = Boolean(ext.fin && depart && memePoint(ext.fin, depart));
  const strategie = parsed.data.strategie ?? "proche";
  const extremites = { premierId: ext.premierId, dernierId: ext.dernierId, fin: ext.fin, strategie };

  // Sens habituel de la tournée : biais doux sur l'ordre des villages (jamais au détriment des horaires).
  const run2 = await runPourSens(supabase, appUser.organization_id, run.id).catch(() => null);
  const sensCtx = run2 ? await sensDeLaTournee(supabase, appUser.organization_id, appUser.id, run2).catch(() => null) : null;
  const modeSens: ModeSens = parsed.data.sens ?? sensCtx?.mode ?? "habituel";
  if (parsed.data.sens && parsed.data.memoriser !== false && sensCtx?.scope && sensCtx.persiste && parsed.data.sens !== sensCtx.mode) {
    const pref = await lirePreferenceSens(supabase, appUser.organization_id, sensCtx.scope);
    await ecrirePreferenceSens(supabase, appUser.organization_id, appUser.id, sensCtx.scope, pref, { mode: parsed.data.sens }).catch(() => false);
  }
  const reference = referenceSens(sensCtx?.habitude ?? null, modeSens);

  // Ordre global des villages : toutes les listes s'enchaînent dans un seul
  // sens de tournée (lib/colis/tournee-globale.ts).
  const neutre = ordonnerListesGlobalement(arrets, listes, depart, retour, distance, extremites);
  const biaise = reference ? ordonnerListesGlobalement(arrets, listes, depart, retour, distance, extremites, { reference }) : null;

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
  // Durée d'arrêt prévue : celle observée sur la fiche client si l'historique existe, sinon la valeur fixe.
  const services = new Map<string, number>();
  for (const s of arrets) {
    const d = dureeServicePrevue(fiches.get(cleAdresse(s.address)), 0);
    if (d > 0 && s.status === "pending") services.set(s.id, d);
  }

  const sequencer = (ordre: typeof neutre.listes): ResultatSequence =>
    sequenceParListes(arrets, ordre, depart, retour, {
      debut: minute,
      fenetres: (id) => fenetres.get(id) ?? null,
      service: (id) => services.get(id),
      distance,
      strategie,
    }, undefined, extremites);
  const bilan = (x: ResultatSequence) => ({ hors: x.horsHoraires.length, ecartes: x.fermes.length + x.impossibles.length, fin: x.fin });
  const memeOrdre = (a: typeof neutre.listes, b: typeof neutre.listes) => a.length === b.length && a.every((l, i) => l.id === b[i]!.id);

  let nouvelOrdre = neutre.listes;
  let r = sequencer(neutre.listes);
  let ecartSens: "horaires" | null = null;
  if (biaise && !memeOrdre(biaise.listes, neutre.listes)) {
    const rb = sequencer(biaise.listes);
    // Les horaires et les fenêtres d'ouverture passent avant l'habitude.
    if (biaisSansRisque(bilan(r), bilan(rb))) {
      nouvelOrdre = biaise.listes;
      r = rb;
    } else ecartSens = "horaires";
  } else if (biaise) nouvelOrdre = biaise.listes;
  const desordre = biaise && !ecartSens ? (biaise.desordreSens ?? null) : null;
  await Promise.all(
    nouvelOrdre.map((l) => (listes.find((x) => x.id === l.id)?.position === l.position ? null : supabase.from("delivery_lists").update({ position: l.position }).eq("id", l.id))),
  );

  // Positions globales et contiguës (0, 1, 2…) dans l'ordre calculé.
  const ecritures = await Promise.all([...r.sequence, ...reportes.map((s) => s.id)].map((id, position) => supabase.from("delivery_stops").update({ position }).eq("id", id)));
  const echec = ecritures.find((w) => w.error)?.error;
  if (echec) return NextResponse.json({ error: "Le nouvel ordre n'a pas pu être enregistré : réessayez." }, { status: 500 });
  await supabase.from("delivery_runs").update({ optimized_at: new Date().toISOString() }).eq("id", run.id);

  const iso = (m: number) => instantParis(jour, m).toISOString();
  return NextResponse.json({
    kmAvant: Math.round(r.kmAvant * 10) / 10,
    kmApres: Math.round(r.kmApres * 10) / 10,
    sansGps: r.sansGps,
    depart: iso(minute),
    finEstimee: r.fin === null ? null : iso(r.fin),
    /** Durée estimée de la tournée (trajets, remises et attentes), retour compris. */
    dureeMin: r.fin === null ? null : Math.round(r.fin - minute),
    /** Départ et arrivée retenus (libellés affichés à l'écran). */
    extremites: { depart: ext.departLibelle, arrivee: ext.arriveeLibelle },
    /** Arrêts avec horaires (annuaire ou créneau) parmi les restants. */
    avecHoraires: arrets.filter((s) => s.status === "pending" && fenetres.get(s.id) !== null).length,
    horsHoraires: r.horsHoraires,
    fermes: r.fermes,
    impossibles: r.impossibles,
    distanceRoutiere: !matrice.estimation(),
    /** Adresses dont la durée d'arrêt est celle observée (fiche client) et non la valeur fixe de 3 min. */
    dureesApprises: services.size,
    /** Sens de la tournée : choix retenu, ordre habituel suivi, ou écarté pour tenir les horaires. */
    sens: {
      mode: modeSens,
      habitude: sensCtx?.habitude ? libelleSens(sensCtx.habitude.ordre) : null,
      applique: reference !== null && ecartSens === null,
      suivi: desordre === 0,
      ecarte: ecartSens,
    },
    passages: Object.fromEntries(
      Object.entries(r.passages).map(([id, p]) => [id, { arrivee: iso(p.arrivee), attenteMin: Math.round(p.attente), statut: p.statut }]),
    ),
  });
}
