import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, tourneeDuJour, STOP_FIELDS } from "@/lib/colis/serveur";

/** Tournée colis du jour du chauffeur connecté, avec ses arrêts dans l'ordre. */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const run = await tourneeDuJour(supabase, appUser);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 500 });
  const { data: stops } = await supabase.from("delivery_stops").select(STOP_FIELDS).eq("run_id", run.id).order("position").order("created_at");
  return NextResponse.json({ run, stops: stops ?? [] });
}

const patchSchema = z.object({
  status: z.enum(["loading", "in_progress", "done"]).optional(),
  return_to_start: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeDuJour(supabase, appUser);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 500 });
  const { error } = await supabase.from("delivery_runs").update(parsed.data).eq("id", run.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
