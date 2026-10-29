import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { depotDuService, lireExtremitesRun, moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { resoudreExtremites } from "@/lib/colis/extremites";
import { ligneDroite, troncons, type Itineraire, type Point } from "@/lib/colis/itineraire";
import { manoeuvresOsrm, type EtapeOsrm } from "@/lib/colis/manoeuvres";

const bodySchema = z.object({
  /** Absent pour « Aller à… » (destination libre, sans tournée) : seule la voie rapide ci-dessous est alors permise. */
  run_id: z.string().uuid().optional(),
  depuis: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
  /**
   * GO Navigation : trajet vers ce seul arrêt (depuis la position du
   * chauffeur, sinon le dépôt) au lieu de toute la suite de la tournée.
   */
  cible: z.union([z.string().uuid(), z.literal("retour")]).nullable().optional(),
  /** Destination : retour de fin de tournée (dépôt, siège) quand `cible` vaut « retour » ; avec `cible` et `depuis`, voie rapide sans base de données. */
  point: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
});

/** Service d'itinéraires compatible OSRM (serveur de démonstration public par défaut). */
const ROUTING_URL = process.env.ROUTING_URL ?? "https://router.project-osrm.org";
const cache = new Map<string, Itineraire>();

/**
 * Un tronçon routier. `etapes` : GO Navigation demande aussi les manœuvres
 * (steps=true) pour les indications de direction.
 */
async function troncon(points: Point[], etapes = false): Promise<Itineraire> {
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const cle = etapes ? `${coords}|etapes` : coords;
  const enCache = cache.get(cle);
  if (enCache) return enCache;
  try {
    const res = await fetch(`${ROUTING_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson${etapes ? "&steps=true" : ""}`, {
      headers: { "User-Agent": "GODAC (https://godac.app)" },
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as {
      code?: string;
      routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number; legs?: { steps?: EtapeOsrm[] }[] }[];
    };
    const r = data.routes?.[0];
    if (!res.ok || data.code !== "Ok" || !r) return ligneDroite(points);
    const it: Itineraire = { ligne: r.geometry.coordinates, distanceKm: Math.round(r.distance / 100) / 10, dureeMin: Math.round(r.duration / 60), approx: false };
    if (etapes) it.manoeuvres = manoeuvresOsrm(r.legs);
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
    cache.set(cle, it);
    return it;
  } catch {
    return ligneDroite(points);
  }
}

/**
 * Tracé de la suite de la tournée (position du chauffeur ou dépôt → arrêts
 * restants dans l'ordre → retour au dépôt) pour la carte intégrée.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  // Voie rapide (GO Navigation, recalcul en route) : position et destination fournies, aucun accès base de données.
  if (parsed.data.cible && parsed.data.depuis && parsed.data.point) return NextResponse.json(await troncon([parsed.data.depuis, parsed.data.point], true));
  // Sans tournée (« Aller à… »), seul le trajet position → destination est servi : rien ne se lit en base.
  if (!parsed.data.run_id) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  const depot = run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
  if (parsed.data.cible === "retour") {
    const arrivee = parsed.data.point;
    const depart = parsed.data.depuis ?? depot;
    if (!arrivee || !depart) return NextResponse.json({ ligne: [], distanceKm: 0, dureeMin: 0, approx: false } satisfies Itineraire);
    return NextResponse.json(await troncon([depart, arrivee], true));
  }
  if (parsed.data.cible) {
    const { data: arret } = await supabase.from("delivery_stops").select("lat, lng").eq("run_id", run.id).eq("id", parsed.data.cible).maybeSingle();
    if (!arret) return NextResponse.json({ error: "Arrêt introuvable dans cette tournée." }, { status: 404 });
    const depart = parsed.data.depuis ?? depot;
    if (!depart || arret.lat === null || arret.lng === null) return NextResponse.json({ ligne: [], distanceKm: 0, dureeMin: 0, approx: false } satisfies Itineraire);
    return NextResponse.json(await troncon([depart, { lat: Number(arret.lat), lng: Number(arret.lng) }], true));
  }

  const [{ data: tous }, memorise] = await Promise.all([
    supabase.from("delivery_stops").select("id, lat, lng, status, address, list_id, position").eq("run_id", run.id).order("position"),
    lireExtremitesRun(supabase, run.id),
  ]);
  const stops = (tous ?? []).filter((s) => s.status === "pending" && s.lat !== null);
  // Départ et arrivée choisis (dépôt, adresse, arrêt…) : le tracé les inclut ; sans choix, comportement historique.
  let depotEff = depot;
  if (!depotEff) {
    const trouve = (await depotDuService(supabase, appUser, run.service_id).catch(() => null)) as { lat: number | string; lng: number | string } | null;
    if (trouve) depotEff = { lat: Number(trouve.lat), lng: Number(trouve.lng) };
  }
  const ext = resoudreExtremites({ depart: memorise.depart, arrivee: memorise.arrivee, depot: depotEff, position: parsed.data.depuis ?? null, arrets: (tous ?? []) as never[], retourParDefaut: run.return_to_start });
  const debut: Point | null = !ext.erreur && memorise.depart ? ext.depart : (parsed.data.depuis ?? depot);
  const fin: Point | null = !ext.erreur && memorise.arrivee ? ext.fin : run.return_to_start && depot ? depot : null;
  const suite = stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }));
  // Un arrêt choisi comme départ ouvre le tracé : pas de point en double.
  if (debut && suite[0] && Math.abs(suite[0].lat - debut.lat) < 1e-6 && Math.abs(suite[0].lng - debut.lng) < 1e-6) suite.shift();
  const memeLieu = (a: Point, b: Point) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
  // Un arrêt choisi comme arrivée ferme le tracé de la même façon.
  const finTrace = fin && suite.length && memeLieu(suite[suite.length - 1]!, fin) ? null : fin;
  const points: Point[] = [...(debut ? [debut] : []), ...suite, ...(finTrace ? [finTrace] : [])];
  if (points.length < 2) return NextResponse.json({ ligne: [], distanceKm: 0, dureeMin: 0, approx: false });

  const parties = await Promise.all(troncons(points).map((t) => troncon(t)));
  return NextResponse.json({
    ligne: parties.flatMap((p, i) => (i === 0 ? p.ligne : p.ligne.slice(1))),
    distanceKm: Math.round(parties.reduce((t, p) => t + p.distanceKm, 0) * 10) / 10,
    dureeMin: parties.some((p) => p.dureeMin === null) ? null : parties.reduce((t, p) => t + (p.dureeMin ?? 0), 0),
    approx: parties.some((p) => p.approx),
  } satisfies Itineraire);
}
