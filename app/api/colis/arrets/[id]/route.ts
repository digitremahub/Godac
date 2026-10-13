import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { moduleActif, STOP_FIELDS } from "@/lib/colis/serveur";

const patchSchema = z.object({
  status: z.enum(["pending", "delivered", "failed"]).optional(),
  adresse: z.string().trim().min(5).max(300).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  destinataire: z.string().trim().max(120).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  parcel_count: z.number().int().min(1).max(500).optional(),
  /** Fait passer l'arrêt avant / après son voisin encore à livrer. */
  deplacer: z.enum(["haut", "bas"]).optional(),
});

/** Livré / échec / adresse corrigée (re-géocodée). RLS : le chauffeur de la tournée ou l'encadrement. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { adresse, status, notes, destinataire, telephone, parcel_count, deplacer } = parsed.data;

  if (deplacer) {
    const { data: stop } = await supabase.from("delivery_stops").select("id, run_id, position").eq("id", id).maybeSingle();
    if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
    const { data: voisins } = await supabase.from("delivery_stops").select("id, position").eq("run_id", stop.run_id).eq("status", "pending").order("position");
    const liste = voisins ?? [];
    const i = liste.findIndex((v) => v.id === id);
    const j = deplacer === "haut" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= liste.length) return NextResponse.json({ ok: true });
    const autre = liste[j]!;
    await supabase.from("delivery_stops").update({ position: autre.position }).eq("id", id);
    await supabase.from("delivery_stops").update({ position: stop.position }).eq("id", autre.id);
    return NextResponse.json({ ok: true });
  }

  const update: Record<string, unknown> = {};
  if (destinataire !== undefined) update.recipient = destinataire || null;
  if (parcel_count !== undefined) update.parcel_count = parcel_count;
  if (telephone !== undefined) {
    const tel = normaliserTelephone(telephone);
    if (telephone && !tel) return NextResponse.json({ error: "Numéro de téléphone non reconnu." }, { status: 400 });
    update.phone = tel;
  }
  if (status) {
    update.status = status;
    update.done_at = status === "pending" ? null : new Date().toISOString();
    if (status !== "delivered") update.delivered_place = null;
  }
  if (notes !== undefined) update.notes = notes;
  if (adresse) {
    const geo = await geocodeAddress(adresse, await codePays(appUser.organization_id));
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
