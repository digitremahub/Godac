import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listesDeTournee, moduleActif, renumeroterListes, tourneeParId } from "@/lib/colis/serveur";

/** La liste et sa tournée, seulement si la tournée est celle du chauffeur connecté. */
async function contexte(id: string) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return { erreur: NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 }) };
  const { data: liste } = await supabase.from("delivery_lists").select("id, run_id, name, position").eq("id", id).maybeSingle();
  const run = liste ? await tourneeParId(supabase, appUser, liste.run_id) : null;
  if (!liste || !run) return { erreur: NextResponse.json({ error: "Liste introuvable." }, { status: 404 }) };
  return { supabase, liste, run };
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  /** Fait passer la liste avant / après sa voisine. */
  deplacer: z.enum(["haut", "bas"]).optional(),
});

/** Renommer une liste ou changer sa place dans la tournée. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { name, deplacer } = parsed.data;

  if (name) {
    const { error } = await ctx.supabase.from("delivery_lists").update({ name }).eq("id", ctx.liste.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (deplacer) {
    const listes = await listesDeTournee(ctx.supabase, ctx.run.id);
    const i = listes.findIndex((l) => l.id === ctx.liste.id);
    const j = deplacer === "haut" ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < listes.length) {
      const ordre = [...listes];
      [ordre[i], ordre[j]] = [ordre[j]!, ordre[i]!];
      // Positions renumérotées 0, 1, 2… dans le nouvel ordre.
      await renumeroterListes(ctx.supabase, ordre);
    }
  }
  return NextResponse.json({ ok: true });
}

/**
 * Supprime une liste. Une liste qui contient des arrêts n'est jamais
 * supprimée avec eux : il faut indiquer une autre liste de la tournée
 * (?vers=<id>) où les ranger d'abord.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const vers = new URL(req.url).searchParams.get("vers");
  const { count } = await ctx.supabase.from("delivery_stops").select("id", { count: "exact", head: true }).eq("list_id", ctx.liste.id);

  if (count) {
    if (!vers || vers === ctx.liste.id) {
      return NextResponse.json({ error: `La liste contient ${count} arrêt(s) : choisissez la liste où les déplacer.` }, { status: 409 });
    }
    const { data: cible } = await ctx.supabase.from("delivery_lists").select("id").eq("id", vers).eq("run_id", ctx.run.id).maybeSingle();
    if (!cible) return NextResponse.json({ error: "Liste de destination introuvable dans cette tournée." }, { status: 400 });
    const { error } = await ctx.supabase.from("delivery_stops").update({ list_id: cible.id }).eq("list_id", ctx.liste.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Contrôle final : jamais d'arrêt supprimé (ni détaché) en silence.
  const { count: reste } = await ctx.supabase.from("delivery_stops").select("id", { count: "exact", head: true }).eq("list_id", ctx.liste.id);
  if (reste) return NextResponse.json({ error: "Des arrêts sont encore dans cette liste, réessayez." }, { status: 409 });
  const { error } = await ctx.supabase.from("delivery_lists").delete().eq("id", ctx.liste.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await renumeroterListes(ctx.supabase, await listesDeTournee(ctx.supabase, ctx.run.id));
  return NextResponse.json({ ok: true });
}
