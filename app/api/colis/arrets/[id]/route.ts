import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { listeDeLaTournee, moduleActif, STOP_FIELDS } from "@/lib/colis/serveur";
import { ecrireHeure, lireHeure } from "@/lib/colis/horaires";
import { POIDS_MAX_KG, lirePoids } from "@/lib/colis/poids";

const patchSchema = z.object({
  status: z.enum(["pending", "delivered", "failed"]).optional(),
  /** Livraison ou ramasse (enlèvement chez un expéditeur). */
  type: z.enum(["livraison", "ramasse"]).optional(),
  /** Poids des colis de l'arrêt en kg ; null : poids inconnu. */
  poids: z.number().positive().max(POIDS_MAX_KG).nullable().optional(),
  adresse: z.string().trim().min(5).max(300).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  destinataire: z.string().trim().max(120).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  parcel_count: z.number().int().min(1).max(500).optional(),
  /** Fait passer l'arrêt avant / après son voisin encore à livrer. */
  deplacer: z.enum(["haut", "bas"]).optional(),
  /** Range l'arrêt dans une autre liste de la même tournée (en fin de liste). */
  list_id: z.string().uuid().optional(),
  /**
   * Créneau ponctuel pour aujourd'hui (« avant 10 h » : fin seule) ;
   * prioritaire sur les horaires de l'annuaire. null : retirer le créneau.
   */
  creneau: z
    .object({ debut: z.string().nullable(), fin: z.string().nullable() })
    .refine((c) => (c.debut === null || lireHeure(c.debut) !== null) && (c.fin === null || lireHeure(c.fin) !== null), "Heure invalide")
    .refine((c) => c.debut !== null || c.fin !== null, "Créneau vide")
    .refine((c) => c.debut === null || c.fin === null || lireHeure(c.debut)! < lireHeure(c.fin)!, "Créneau incohérent")
    .nullable()
    .optional(),
});

/** Livré / échec / type (livraison ou ramasse) / adresse corrigée (re-géocodée). RLS : le chauffeur de la tournée ou l'encadrement. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { adresse, status, type, poids, notes, destinataire, telephone, parcel_count, deplacer, list_id, creneau } = parsed.data;

  if (list_id) {
    const { data: stop } = await supabase.from("delivery_stops").select("id, run_id, list_id").eq("id", id).maybeSingle();
    if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
    if (stop.list_id === list_id) return NextResponse.json({ ok: true });
    if (!(await listeDeLaTournee(supabase, stop.run_id, list_id))) return NextResponse.json({ error: "Liste introuvable dans cette tournée." }, { status: 400 });
    const { data: dernier } = await supabase.from("delivery_stops").select("position").eq("run_id", stop.run_id).order("position", { ascending: false }).limit(1).maybeSingle();
    const { error } = await supabase
      .from("delivery_stops")
      .update({ list_id, position: (dernier?.position ?? 0) + 1 })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (deplacer) {
    const { data: stop } = await supabase.from("delivery_stops").select("id, run_id, list_id, position").eq("id", id).maybeSingle();
    if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
    // Voisin encore à livrer dans la même liste.
    let q = supabase.from("delivery_stops").select("id, position").eq("run_id", stop.run_id).eq("status", "pending");
    q = stop.list_id ? q.eq("list_id", stop.list_id) : q.is("list_id", null);
    const { data: voisins } = await q.order("position");
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
    const tel = normaliserTelephone(telephone, await codePays(appUser.organization_id));
    if (telephone && !tel) return NextResponse.json({ error: "Numéro de téléphone non reconnu." }, { status: 400 });
    update.phone = tel;
  }
  if (status) {
    update.status = status;
    update.done_at = status === "pending" ? null : new Date().toISOString();
    if (status !== "delivered") Object.assign(update, { delivered_place: null, proof_code: null });
  }
  if (type) update.kind = type;
  if (poids !== undefined) update.weight_kg = poids === null ? null : lirePoids(poids);
  if (notes !== undefined) update.notes = notes;
  if (creneau !== undefined) {
    const heure = (v: string | null | undefined) => (v ? ecrireHeure(lireHeure(v)!) : null);
    Object.assign(update, { window_start: heure(creneau?.debut), window_end: heure(creneau?.fin) });
  }
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
