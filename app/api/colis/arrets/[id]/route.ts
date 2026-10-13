import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { moduleActif, STOP_FIELDS } from "@/lib/colis/serveur";

const patchSchema = z.object({
  status: z.enum(["pending", "delivered", "failed"]).optional(),
  adresse: z.string().trim().min(5).max(300).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/** Livré / échec / adresse corrigée (re-géocodée). RLS : le chauffeur de la tournée ou l'encadrement. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { adresse, status, notes } = parsed.data;
  const update: Record<string, unknown> = {};
  if (status) {
    update.status = status;
    update.done_at = status === "pending" ? null : new Date().toISOString();
  }
  if (notes !== undefined) update.notes = notes;
  if (adresse) {
    const geo = await geocodeAddress(adresse);
    Object.assign(update, { address: adresse, lat: geo?.lat ?? null, lng: geo?.lng ?? null });
  }
  const { data, error } = await supabase.from("delivery_stops").update(update).eq("id", id).select(STOP_FIELDS).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
  return NextResponse.json({ stop: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const { error } = await supabase.from("delivery_stops").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
