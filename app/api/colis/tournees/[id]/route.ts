import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, tourneeParId, STOP_FIELDS } from "@/lib/colis/serveur";

async function contexte(id: string) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return { erreur: NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 }) };
  const run = await tourneeParId(supabase, appUser, id);
  if (!run) return { erreur: NextResponse.json({ error: "Tournée introuvable." }, { status: 404 }) };
  return { supabase, run };
}

/** Une tournée et ses arrêts dans l'ordre. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const { data: stops } = await ctx.supabase.from("delivery_stops").select(STOP_FIELDS).eq("run_id", ctx.run.id).order("position").order("created_at");
  return NextResponse.json({ run: ctx.run, stops: stops ?? [] });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  status: z.enum(["loading", "in_progress", "done"]).optional(),
  return_to_start: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { error } = await ctx.supabase.from("delivery_runs").update(parsed.data).eq("id", ctx.run.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Supprime la tournée et tous ses arrêts. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const { error } = await ctx.supabase.from("delivery_runs").delete().eq("id", ctx.run.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
