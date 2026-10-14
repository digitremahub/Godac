import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { avecHoraires, listesDeTournee, moduleActif, tourneeParId, STOP_FIELDS } from "@/lib/colis/serveur";
import { ecrireHeure, lireHeure } from "@/lib/colis/horaires";
import { ordonnerParListe } from "@/lib/colis/listes";

async function contexte(id: string) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return { erreur: NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 }) };
  const run = await tourneeParId(supabase, appUser, id);
  if (!run) return { erreur: NextResponse.json({ error: "Tournée introuvable." }, { status: 404 }) };
  return { supabase, run, appUser };
}

/**
 * Une tournée, ses listes et ses arrêts dans l'ordre de livraison (liste
 * après liste), chacun avec sa fiche horaires (`horaire`) si son adresse
 * figure dans l'annuaire des adresses pro de l'entreprise.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const [{ data: stops }, lists] = await Promise.all([
    ctx.supabase.from("delivery_stops").select(STOP_FIELDS).eq("run_id", ctx.run.id).order("position").order("created_at"),
    listesDeTournee(ctx.supabase, ctx.run.id),
  ]);
  const ordonnes = ordonnerParListe((stops ?? []) as { id: string; list_id: string | null; position: number; address: string }[], lists);
  return NextResponse.json({ run: ctx.run, lists, stops: await avecHoraires(ctx.supabase, ctx.appUser.organization_id, ordonnes) });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  status: z.enum(["loading", "in_progress", "done"]).optional(),
  return_to_start: z.boolean().optional(),
  /** Heure de départ prévue (« 07:30 ») pour les heures de passage ; null = 08:00. */
  heure_depart: z
    .string()
    .refine((v) => lireHeure(v) !== null, "Heure invalide")
    .nullable()
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { heure_depart, ...champs } = parsed.data;
  const update: Record<string, unknown> = { ...champs };
  if (heure_depart !== undefined) update.planned_start = heure_depart === null ? null : ecrireHeure(lireHeure(heure_depart)!);
  // Début réel de la livraison (estimation de fin) ; à la clôture, la
  // dernière position partagée est effacée (aucune conservation).
  if (parsed.data.status === "in_progress" && !(ctx.run as { started_at?: string | null }).started_at) update.started_at = new Date().toISOString();
  if (parsed.data.status && parsed.data.status !== "in_progress") Object.assign(update, { last_lat: null, last_lng: null, last_position_at: null });
  const { error } = await ctx.supabase.from("delivery_runs").update(update).eq("id", ctx.run.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Supprime la tournée et tous ses arrêts. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await contexte((await params).id);
  if ("erreur" in ctx) return ctx.erreur;
  if (ctx.run.status === "done") return NextResponse.json({ error: "Une tournée clôturée ne peut pas être supprimée : elle est conservée dans l'historique de livraison." }, { status: 409 });
  const { error } = await ctx.supabase.from("delivery_runs").delete().eq("id", ctx.run.id).neq("status", "done");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
