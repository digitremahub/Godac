import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, tourneeParId } from "@/lib/colis/serveur";

const bodySchema = z.union([
  z.object({ run_id: z.string().uuid(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  z.object({ run_id: z.string().uuid(), masquer: z.literal(true) }),
]);

/**
 * Dernière position du chauffeur pendant sa tournée colis en cours, pour
 * la carte de suivi de l'exploitation. Écrase la précédente (aucun
 * historique) et n'est acceptée que tournée en cours ; « masquer »
 * l'efface (pause).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  if (run.status !== "in_progress") return NextResponse.json({ ok: true, ignore: true });

  const update =
    "masquer" in parsed.data
      ? { last_lat: null, last_lng: null, last_position_at: null }
      : { last_lat: parsed.data.lat, last_lng: parsed.data.lng, last_position_at: new Date().toISOString() };
  const { error } = await supabase.from("delivery_runs").update(update).eq("id", run.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
