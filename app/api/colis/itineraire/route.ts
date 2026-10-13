import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { ligneDroite, troncons, type Itineraire, type Point } from "@/lib/colis/itineraire";

const bodySchema = z.object({
  run_id: z.string().uuid(),
  depuis: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
});

/** Service d'itinéraires compatible OSRM (serveur de démonstration public par défaut). */
const ROUTING_URL = process.env.ROUTING_URL ?? "https://router.project-osrm.org";
const cache = new Map<string, Itineraire>();

async function troncon(points: Point[]): Promise<Itineraire> {
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const enCache = cache.get(coords);
  if (enCache) return enCache;
  try {
    const res = await fetch(`${ROUTING_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`, {
      headers: { "User-Agent": "GODAC (https://godac.app)" },
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { code?: string; routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[] };
    const r = data.routes?.[0];
    if (!res.ok || data.code !== "Ok" || !r) return ligneDroite(points);
    const it: Itineraire = { ligne: r.geometry.coordinates, distanceKm: Math.round(r.distance / 100) / 10, dureeMin: Math.round(r.duration / 60), approx: false };
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
    cache.set(coords, it);
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
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  const { data: stops } = await supabase
    .from("delivery_stops")
    .select("lat, lng")
    .eq("run_id", run.id)
    .eq("status", "pending")
    .not("lat", "is", null)
    .order("position");
  const depot = run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
  const points: Point[] = [
    ...(parsed.data.depuis ? [parsed.data.depuis] : depot ? [depot] : []),
    ...(stops ?? []).map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })),
    ...(run.return_to_start && depot ? [depot] : []),
  ];
  if (points.length < 2) return NextResponse.json({ ligne: [], distanceKm: 0, dureeMin: 0, approx: false });

  const parties = await Promise.all(troncons(points).map(troncon));
  return NextResponse.json({
    ligne: parties.flatMap((p, i) => (i === 0 ? p.ligne : p.ligne.slice(1))),
    distanceKm: Math.round(parties.reduce((t, p) => t + p.distanceKm, 0) * 10) / 10,
    dureeMin: parties.some((p) => p.dureeMin === null) ? null : parties.reduce((t, p) => t + (p.dureeMin ?? 0), 0),
    approx: parties.some((p) => p.approx),
  } satisfies Itineraire);
}
