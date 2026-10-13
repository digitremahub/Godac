import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { moduleActif, STOP_FIELDS } from "@/lib/colis/serveur";
import { LIEUX_LIVRAISON, libelleLieu, photoObligatoire } from "@/lib/colis/livraison";

const BUCKET = "delivery-proofs";
const bodySchema = z.object({
  lieu: z.enum(LIEUX_LIVRAISON.map((l) => l.key) as [string, ...string[]]),
  precision: z.string().trim().max(200).nullable().optional(),
  // Photo JPEG réduite côté téléphone (≈ 1600 px) : 5 Mo en base64 au plus.
  image: z.string().max(7_000_000).nullable().optional(),
});

/**
 * Colis livré : lieu de dépôt + photo (obligatoire pour la boîte aux
 * lettres et le jardin). L'accès à l'arrêt est vérifié par la RLS
 * (chauffeur de la tournée ou encadrement) avant tout envoi de fichier.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { lieu, precision, image } = parsed.data;
  if (photoObligatoire(lieu as never) && !image) {
    return NextResponse.json({ error: `Photo obligatoire pour une livraison « ${libelleLieu(lieu)} ».` }, { status: 400 });
  }

  const { data: stop } = await supabase.from("delivery_stops").select("id, notes, proof_photo_path, delivery_runs(run_date)").eq("id", id).maybeSingle();
  if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });

  const admin = createAdminSupabaseClient();
  let path: string | null = stop.proof_photo_path;
  if (image) {
    const octets = Buffer.from(image, "base64");
    // JPEG uniquement (la photo est convertie sur le téléphone avant envoi).
    if (octets.length < 1000 || octets[0] !== 0xff || octets[1] !== 0xd8) return NextResponse.json({ error: "Photo illisible, reprenez-la." }, { status: 400 });
    const jour = ((stop as any).delivery_runs?.run_date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    path = `${appUser.organization_id}/${jour}/${id}-${Date.now()}.jpg`;
    const { error } = await admin.storage.from(BUCKET).upload(path, octets, { contentType: "image/jpeg" });
    if (error) return NextResponse.json({ error: "Envoi de la photo impossible, réessayez." }, { status: 502 });
    if (stop.proof_photo_path) await admin.storage.from(BUCKET).remove([stop.proof_photo_path]);
  }

  const note = precision ? `${libelleLieu(lieu)} : ${precision}` : null;
  const { data, error } = await supabase
    .from("delivery_stops")
    .update({
      status: "delivered",
      done_at: new Date().toISOString(),
      delivered_place: lieu,
      proof_photo_path: path,
      ...(note ? { notes: [stop.notes, note].filter(Boolean).join(" · ").slice(0, 500) } : {}),
    })
    .eq("id", id)
    .select(STOP_FIELDS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stop: data });
}

/** Lien temporaire (5 min) vers la photo de livraison. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { id } = await params;
  const { data: stop } = await supabase.from("delivery_stops").select("proof_photo_path").eq("id", id).maybeSingle();
  if (!stop?.proof_photo_path) return NextResponse.json({ error: "Pas de photo pour cette livraison." }, { status: 404 });
  const { data } = await createAdminSupabaseClient().storage.from(BUCKET).createSignedUrl(stop.proof_photo_path, 300);
  if (!data?.signedUrl) return NextResponse.json({ error: "Photo indisponible (effacée après 30 jours ?)." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
