import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { moduleActif, STOP_FIELDS } from "@/lib/colis/serveur";
import { refusCloture } from "@/lib/colis/cloture";
import { CODE_QR_MAX, LIEUX_LIVRAISON, libelleLieu, normaliserCodeQr, qrObligatoire, refusPreuve, relaisObligatoire, type LieuLivraison } from "@/lib/colis/livraison";
import { NOM_RELAIS_MAX, RETOURS_MAX, normaliserNomRelais } from "@/lib/colis/relais";

const BUCKET = "delivery-proofs";
const bodySchema = z.object({
  lieu: z.enum(LIEUX_LIVRAISON.map((l) => l.key) as [string, ...string[]]),
  precision: z.string().trim().max(200).nullable().optional(),
  // Photo JPEG réduite côté téléphone (≈ 1600 px) : 5 Mo en base64 au plus.
  image: z.string().max(7_000_000).nullable().optional(),
  images: z.array(z.string().max(7_000_000)).max(3).optional(),
  /** Livraison avec QR code : valeur lue sur le QR code (ou code de retrait) du destinataire. */
  code_qr: z.string().max(CODE_QR_MAX * 2).nullable().optional(),
  /** Point relais : nom ou adresse du relais (celui de l'arrêt point relais par défaut). */
  relais: z.string().max(NOM_RELAIS_MAX * 2).nullable().optional(),
  /** Arrêt point relais : retours repris au relais (packages_picked_up). */
  retours: z.number().int().min(0).max(RETOURS_MAX).nullable().optional(),
  /** Arrêt point relais : colis effectivement déposés (packages_delivered). */
  deposes: z.number().int().min(0).max(RETOURS_MAX).nullable().optional(),
  message_laisse: z.boolean().optional(),
  reserve: z.string().trim().max(500).nullable().optional(),
});

/**
 * Colis livré : lieu de dépôt + photo (obligatoire pour la boîte aux
 * lettres et le jardin), ou QR code du destinataire scanné (livraison
 * « avec QR code » : la valeur lue est la preuve de remise), ou dépôt au
 * point relais (arrêt point relais, ou livraison remise au relais en cas
 * d'absence) : nom du relais, photo ou code du relais scanné, retours
 * repris pour un arrêt point relais. L'accès à l'arrêt est vérifié par la RLS
 * (chauffeur de la tournée ou encadrement) avant tout envoi de fichier.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { precision, message_laisse, reserve } = parsed.data;
  const lieu = parsed.data.lieu as LieuLivraison;
  const images = (parsed.data.images?.length ? parsed.data.images : parsed.data.image ? [parsed.data.image] : []).slice(0, 3);

  const { data: stop } = await supabase
    .from("delivery_stops")
    .select("id, status, notes, kind, relay_name, address, proof_photo_path, proof_photo_paths, delivery_runs(run_date)")
    .eq("id", id)
    .maybeSingle();
  if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
  const pointRelais = stop.kind === "point_relais";
  // Un arrêt point relais se clôture par un dépôt au relais.
  if (pointRelais && !relaisObligatoire(lieu)) return NextResponse.json({ error: "Arrêt point relais : validez le dépôt au relais." }, { status: 400 });
  // Code scanné : QR code du destinataire, ou code / bordereau du relais (facultatif avec une photo).
  const codeQr = qrObligatoire(lieu) || relaisObligatoire(lieu) ? normaliserCodeQr(parsed.data.code_qr) : null;
  const relais = relaisObligatoire(lieu) ? (normaliserNomRelais(parsed.data.relais) ?? (pointRelais ? normaliserNomRelais(stop.relay_name) : null)) : null;
  // L'arrêt point relais est le relais lui-même : son nom n'est pas exigé.
  const preuveManquante = refusPreuve({ lieu, photo: images.length > 0, code: codeQr, relais: relais ?? (pointRelais ? stop.address : null) });
  if (preuveManquante) return NextResponse.json({ error: preuveManquante }, { status: 400 });
  // N'importe quel arrêt de la tournée peut être livré, mais une seule fois.
  const refus = refusCloture(stop.status, "delivered");
  if (refus) return NextResponse.json({ error: refus }, { status: 409 });

  const admin = createAdminSupabaseClient();
  const anciens = Array.isArray((stop as any).proof_photo_paths) ? (stop as any).proof_photo_paths as string[] : [];
  let paths: string[] = anciens.length ? [...anciens] : stop.proof_photo_path ? [stop.proof_photo_path] : [];
  const televerses: string[] = [];
  if (images.length) {
    const jour = ((stop as any).delivery_runs?.run_date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    for (const [index, encoded] of images.entries()) {
      const octets = Buffer.from(encoded, "base64");
      if (octets.length < 1000 || octets[0] !== 0xff || octets[1] !== 0xd8) {
        if (televerses.length) await admin.storage.from(BUCKET).remove(televerses);
        return NextResponse.json({ error: "Photo " + (index + 1) + " illisible, reprenez-la." }, { status: 400 });
      }
      const path = `${appUser.organization_id}/${jour}/${id}-${Date.now()}-${index}.jpg`;
      const { error } = await admin.storage.from(BUCKET).upload(path, octets, { contentType: "image/jpeg" });
      if (error) {
        if (televerses.length) await admin.storage.from(BUCKET).remove(televerses);
        return NextResponse.json({ error: "Envoi des photos impossible, réessayez." }, { status: 502 });
      }
      televerses.push(path);
    }
    paths = televerses;
  }

  const notesAjoutees = [
    precision ? `${libelleLieu(lieu)} : ${precision}` : null,
    message_laisse ? "M — Message laissé / avis de passage" : null,
    reserve ? `Réserve : ${reserve}` : null,
  ].filter(Boolean) as string[];
  const { data, error } = await supabase
    .from("delivery_stops")
    .update({
      status: "delivered",
      done_at: new Date().toISOString(),
      delivered_place: lieu,
      proof_photo_path: paths[0] ?? null,
      proof_photo_paths: paths,
      proof_code: codeQr,
      ...(relaisObligatoire(lieu) ? { relay_name: relais } : pointRelais ? {} : { relay_name: null }),
      // Arrêt point relais : retours repris (colis récupérés au relais).
      ...(pointRelais && typeof parsed.data.retours === "number" ? { packages_picked_up: parsed.data.retours } : {}),
      ...(pointRelais && typeof parsed.data.deposes === "number" ? { packages_delivered: parsed.data.deposes } : {}),
      failure_reason: null,
      ...(notesAjoutees.length ? { notes: [stop.notes, ...notesAjoutees].filter(Boolean).join(" · ").slice(0, 500) } : {}),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select(STOP_FIELDS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Arrêt déjà clôturé entre-temps : actualisez." }, { status: 409 });
  return NextResponse.json({ stop: data });
}

/** Lien temporaire (5 min) vers la photo de livraison. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { id } = await params;
  // Audit M4 : proof_photo_paths (photos 2 et 3) doit être sélectionné.
  const { data: stop } = await supabase
    .from("delivery_stops")
    .select("proof_photo_path, proof_photo_paths")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  const multiples = Array.isArray(stop?.proof_photo_paths) ? (stop.proof_photo_paths as string[]).filter(Boolean) : [];
  const paths = multiples.length ? multiples : stop?.proof_photo_path ? [stop.proof_photo_path as string] : [];
  const index = Math.max(0, Number(new URL(_req.url).searchParams.get("index") ?? "0") || 0);
  const path = paths[index];
  if (!path) return NextResponse.json({ error: "Photo de preuve introuvable." }, { status: 404 });
  const { data } = await createAdminSupabaseClient().storage.from(BUCKET).createSignedUrl(path, 300);
  if (!data?.signedUrl) return NextResponse.json({ error: "Photo indisponible (effacée après 30 jours ?)." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
