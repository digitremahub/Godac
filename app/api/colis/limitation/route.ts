import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { limiteLaPlusProche, type VoieOSM } from "@/lib/colis/limitation-vitesse";

const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const UA = "GODAC/1.0 (https://godac.app; contact@godac.fr)";
const querySchema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

/** Cache mémoire par maille d'environ 40 m (la limitation d'une route change rarement). */
const cache = new Map<string, { t: number; v: { limite: number | null; route: string | null } }>();
const TTL_MS = 10 * 60_000;

/**
 * Limitation de vitesse indicative à une position (GO Navigation) : balise
 * OpenStreetMap `maxspeed` de la route à moins de 25 m. null si la donnée
 * n'existe pas (le panneau sur place fait foi). Ne lève jamais.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const q = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return NextResponse.json({ error: "Position invalide." }, { status: 400 });
  const { lat, lng } = q.data;
  const cle = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(cle);
  if (hit && Date.now() - hit.t < TTL_MS) return NextResponse.json(hit.v);
  let v: { limite: number | null; route: string | null } = { limite: null, route: null };
  try {
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: new URLSearchParams({ data: `[out:json][timeout:8];way(around:25,${lat},${lng})["highway"]["maxspeed"];out tags geom;` }),
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const voies = ((await res.json()) as { elements?: VoieOSM[] }).elements ?? [];
      const proche = limiteLaPlusProche({ lat, lng }, voies);
      v = { limite: proche?.limite ?? null, route: proche?.route ?? null };
      if (cache.size > 2000) cache.clear();
      cache.set(cle, { t: Date.now(), v });
    }
  } catch {
    // Overpass indisponible : pas de limitation affichée, on réessaiera.
  }
  return NextResponse.json(v);
}
