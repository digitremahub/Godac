import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cleAdresse, horairesDesAdresses, listesDeTournee, moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { sequenceParListes } from "@/lib/colis/listes";
import { fenetresArret, heureDepart, instantParis, lireHeure, type Fenetres } from "@/lib/colis/horaires";
import { distanceEstimee, type Point } from "@/lib/colis/optimisation";
import { rechercherHorairesOSMPlusieurs } from "@/lib/colis/horaires-internet";

const ROUTING_URL = process.env.ROUTING_URL ?? "https://router.project-osrm.org";
const clePoint = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** Matrice des distances routières OSRM ; null en cas d'indisponibilité ou de tournée trop grande. */
async function matriceRoutiere(points: Point[]): Promise<Map<string, number> | null> {
  const uniques = [...new Map(points.map((p) => [clePoint(p), p])).values()];
  if (uniques.length < 2) return new Map();
  // La limite du service public OSRM varie : au-delà de 90 points, repli propre.
  if (uniques.length > 90) return null;
  const coords = uniques.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  try {
    const res = await fetch(`${ROUTING_URL}/table/v1/driving/${coords}?annotations=distance,duration`, {
      headers: { "User-Agent": "GODAC (https://godac.app)" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    const data = (await res.json()) as { code?: string; distances?: (number | null)[][] };
    if (!res.ok || data.code !== "Ok" || !data.distances) return null;
    const resultat = new Map<string, number>();
    uniques.forEach((a, i) => uniques.forEach((b, j) => {
      const metres = data.distances?.[i]?.[j];
      if (typeof metres === "number" && Number.isFinite(metres)) resultat.set(`${clePoint(a)}>${clePoint(b)}`, metres / 1000);
    }));
    return resultat;
  } catch {
    return null;
  }
}

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
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

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
  const matrice = await matriceRoutiere(pointsRoutage);
  let estimationUtilisee = matrice === null;
  const distance = (a: Point, b: Point) => {
    const route = matrice?.get(`${clePoint(a)}>${clePoint(b)}`);
    if (route !== undefined) return route;
    estimationUtilisee = true;
    return distanceEstimee(a, b);
  };

  // Réordonne les listes-villages en séquence géographique globale, en utilisant
  // la distance routière entre le point courant et l'entrée la plus proche de chaque village.
  const groupesVillages = new Map<string, typeof arrets>();
  for (const stop of arrets.filter((s) => s.status === "pending" && s.lat !== null && s.lng !== null)) {
    const cle = stop.list_id ?? "__sans_liste__";
    groupesVillages.set(cle, [...(groupesVillages.get(cle) ?? []), stop]);
  }
  const listesOrdonnees = [...listes];
  let pointCourant = depart;
  const resteListes = new Set(listesOrdonnees.map((l) => l.id));
  const nouvelOrdre: typeof listesOrdonnees = [];
  while (resteListes.size) {
    let meilleure: (typeof listesOrdonnees)[number] | null = null;
    let meilleurArret: (typeof arrets)[number] | null = null;
    let meilleurCout = Number.POSITIVE_INFINITY;
    for (const liste of listesOrdonnees) {
      if (!resteListes.has(liste.id)) continue;
      const candidats = groupesVillages.get(liste.id) ?? [];
      for (const stop of candidats) {
        const p = { lat: Number(stop.lat), lng: Number(stop.lng) };
        const cout = pointCourant ? distance(pointCourant, p) : 0;
        if (cout < meilleurCout) { meilleurCout = cout; meilleure = liste; meilleurArret = stop; }
      }
      // Conserver aussi les listes vides, à la fin.
      if (!candidats.length && !meilleure) meilleure = liste;
    }
    if (!meilleure) break;
    nouvelOrdre.push(meilleure);
    resteListes.delete(meilleure.id);
    if (meilleurArret?.lat !== null && meilleurArret?.lat !== undefined && meilleurArret?.lng !== null && meilleurArret?.lng !== undefined) pointCourant = { lat: Number(meilleurArret.lat), lng: Number(meilleurArret.lng) };
  }
  if (nouvelOrdre.length === listesOrdonnees.length) {
    await Promise.all(nouvelOrdre.map((l, position) => l.position === position ? Promise.resolve() : supabase.from("delivery_lists").update({ position }).eq("id", l.id)));
  }

  // Heure de départ et jour (Paris) des horaires à appliquer.
  const { jour, minute } = heureDepart({ ...run, planned_start: parsed.data.heure_depart ?? run.planned_start }, new Date(), enRoute);
  const fiches = await horairesDesAdresses(
    supabase,
    appUser.organization_id,
    arrets.filter((s) => s.status === "pending").map((s) => s.address),
  );
  // Horaires OSM consultés à la demande, sans stockage ni clé payante.
  // Un seul appel Overpass pour les arrêts localisés (jusqu'à 40 par requête).
  const horairesOSM = await rechercherHorairesOSMPlusieurs(
    arrets
      .filter((s) => s.status === "pending" && s.lat !== null && s.lng !== null)
      .map((s) => ({ id: s.id, address: s.address, lat: Number(s.lat), lng: Number(s.lng) })),
  );
  const fenetres = new Map<string, Fenetres>(
    arrets.map((s) => {
      const horairesManuels = fiches.get(cleAdresse(s.address))?.weekly_schedule;
      const horairesAutomatiques = horairesOSM.get(s.id)?.semaine;
      return [
        s.id,
        fenetresArret({
          semaine: horairesManuels ?? horairesAutomatiques,
          debut: s.window_start,
          fin: s.window_end,
        }, jour),
      ];
    }),
  );

  const r = sequenceParListes(arrets, nouvelOrdre, depart, run.return_to_start && !parsed.data.depuis, {
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
    distanceRoutiere: !estimationUtilisee,
    passages: Object.fromEntries(
      Object.entries(r.passages).map(([id, p]) => [id, { arrivee: iso(p.arrivee), attenteMin: Math.round(p.attente), statut: p.statut }]),
    ),
  });
}
