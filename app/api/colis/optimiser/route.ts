import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, tourneeDuJour } from "@/lib/colis/serveur";
import { longueurParcours, optimiserOrdre, type Point } from "@/lib/colis/optimisation";

const bodySchema = z.object({
  /** Position actuelle du chauffeur : réoptimiser en cours de route à partir d'ici. */
  depuis: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
});

/**
 * Calcule l'ordre de passage des arrêts restants. Les arrêts déjà livrés
 * gardent leur place en tête ; les adresses non localisées passent à la fin.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeDuJour(supabase, appUser);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 500 });

  const { data: stops } = await supabase.from("delivery_stops").select("id, lat, lng, status, position").eq("run_id", run.id).order("position");
  const faits = (stops ?? []).filter((s) => s.status !== "pending");
  const restants = (stops ?? []).filter((s) => s.status === "pending" && s.lat !== null && s.lng !== null);
  const sansGps = (stops ?? []).filter((s) => s.status === "pending" && (s.lat === null || s.lng === null));

  const depot: Point | null = run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null;
  const depart = parsed.data.depuis ?? depot;
  const pts = restants.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }));
  const avant = longueurParcours(depart, pts, run.return_to_start && !parsed.data.depuis);
  const ordre = optimiserOrdre(depart, pts, run.return_to_start && !parsed.data.depuis);
  const apres = longueurParcours(depart, ordre.map((i) => pts[i]!), run.return_to_start && !parsed.data.depuis);

  const sequence = [...faits.map((s) => s.id), ...ordre.map((i) => restants[i]!.id), ...sansGps.map((s) => s.id)];
  await Promise.all(sequence.map((id, position) => supabase.from("delivery_stops").update({ position }).eq("id", id)));
  await supabase.from("delivery_runs").update({ optimized_at: new Date().toISOString() }).eq("id", run.id);

  return NextResponse.json({ kmAvant: Math.round(avant * 10) / 10, kmApres: Math.round(apres * 10) / 10, sansGps: sansGps.length });
}
