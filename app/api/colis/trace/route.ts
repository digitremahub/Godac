import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { MAX_POINTS_REQUETE, pointValide } from "@/lib/colis/trace-gps";

/** Points lus au plus pour une tournée (≈ 8 000 sur une journée de 8 h). */
const MAX_POINTS_LECTURE = 30_000;
const PAGE = 1000;

const pointSchema = z.object({
  t: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  acc: z.number().min(0).max(10_000).nullish(),
  v: z.number().min(0).max(100).nullish(),
  cap: z.number().min(0).max(360).nullish(),
});
const bodySchema = z
  .object({
    run_id: z.string().uuid(),
    // Ancien format : points seuls (min 1). Nouveau : lot éventuellement vide avec la dernière position.
    points: z.array(pointSchema).max(MAX_POINTS_REQUETE).default([]),
    position: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  })
  .refine((b) => b.points.length > 0 || b.position, "Aucun point");

/**
 * Fil d'Ariane GPS de la tournée colis EN COURS (lots envoyés par l'app
 * chauffeur, voir components/colis/useTraceGps.ts). Hors tournée en cours,
 * rien n'est enregistré ({ ignore: true }, le client vide sa file). La
 * table refuse aussi d'elle-même (RLS + trigger de garde). Le même appel
 * peut porter `position` : dernière position du chauffeur pour la carte de
 * suivi (ce que faisait POST /api/colis/position, conservé pour les
 * anciennes versions de l'application).
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  if (run.status !== "in_progress") return NextResponse.json({ ok: true, ignore: true, enregistres: 0 });

  // Points crédibles seulement : précision ≤ 50 m, horodatés pendant la
  // tournée (démarrage − 5 min) et pas dans le futur (+ 2 min d'horloge).
  const maintenant = Date.now();
  const debut = (run as { started_at?: string | null }).started_at ? Date.parse((run as { started_at: string }).started_at) - 5 * 60_000 : maintenant - 24 * 3_600_000;
  const lignes = parsed.data.points
    .filter((p) => pointValide(p) && p.t >= debut && p.t <= maintenant + 2 * 60_000)
    .map((p) => ({
      organization_id: appUser.organization_id,
      run_id: run.id,
      driver_id: appUser.id,
      recorded_at: new Date(p.t).toISOString(),
      lat: p.lat,
      lng: p.lng,
      accuracy: p.acc ?? null,
      speed: p.v ?? null,
      heading: p.cap ?? null,
    }));
  if (lignes.length) {
    const { error } = await supabase.from("delivery_run_track_points").insert(lignes);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (parsed.data.position) {
    const { error } = await supabase
      .from("delivery_runs")
      .update({ last_lat: parsed.data.position.lat, last_lng: parsed.data.position.lng, last_position_at: new Date().toISOString() })
      .eq("id", run.id);
    if (error) console.error("trace: dernière position non enregistrée", error.message);
  }
  return NextResponse.json({ ok: true, enregistres: lignes.length });
}

/**
 * Tracé réel d'une tournée pour l'historique : [lng, lat, t (ms)][] dans
 * l'ordre. La RLS limite la lecture au chauffeur (ses tournées) et à
 * l'encadrement de l'organisation.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const supabase = await createServerSupabaseClient();
  const runId = new URL(req.url).searchParams.get("run_id") ?? "";
  if (!z.string().uuid().safeParse(runId).success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  // La tournée doit être visible (RLS de delivery_runs : la sienne ou l'encadrement).
  const { data: run } = await supabase.from("delivery_runs").select("id").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  const points: [number, number, number][] = [];
  for (let de = 0; de < MAX_POINTS_LECTURE; de += PAGE) {
    const { data, error } = await supabase
      .from("delivery_run_track_points")
      .select("recorded_at, lat, lng")
      .eq("run_id", runId)
      .order("recorded_at")
      .order("id")
      .range(de, de + PAGE - 1);
    if (error) return NextResponse.json({ points: [], indisponible: true });
    for (const p of data ?? []) points.push([Number(p.lng), Number(p.lat), Date.parse(p.recorded_at as string)]);
    if (!data || data.length < PAGE) break;
  }
  return NextResponse.json({ points, tronque: points.length >= MAX_POINTS_LECTURE }, { headers: { "Cache-Control": "private, no-store" } });
}
