import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { pieceCommentaire } from "@/lib/rattachement/commentaires-serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/**
 * Lien temporaire (5 min) vers une pièce d'une amende : l'avis
 * (?i=0, 1…) ou la photo d'un échange (?commentaire=<id>&i=0).
 * L'accès suit la RLS de `fines` (encadrement de son service, comptable,
 * chauffeur désigné) ; le lien est signé par le client service car la
 * lecture directe du bucket est réservée à l'encadrement.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: ["direction", "manager", "exploitation", "comptable", "chauffeur"], modules: ["fines"] });
  if (!g.ok) return g.reponse;
  const { supabase } = g;
  const { id } = await params;
  const url = new URL(req.url);
  const index = Math.max(0, Number(url.searchParams.get("i") ?? "0") || 0);
  const commentaire = url.searchParams.get("commentaire");

  let lecture = await supabase.from("fines").select("id, photo_path, document_paths").eq("id", id).maybeSingle();
  if (lecture.error && estSchemaManquant(lecture.error)) lecture = (await supabase.from("fines").select("id, photo_path").eq("id", id).maybeSingle()) as typeof lecture;
  const fine = lecture.data as { id: string; photo_path: string | null; document_paths?: string[] | null } | null;
  if (!fine) return NextResponse.json({ error: "Amende introuvable." }, { status: 404 });

  let path: string | null;
  if (commentaire) path = await pieceCommentaire(supabase, "fine", id, commentaire, index);
  else {
    const docs = (fine.document_paths ?? []).filter(Boolean);
    const paths = docs.length ? docs : fine.photo_path ? [fine.photo_path] : [];
    path = paths[index] ?? null;
  }
  if (!path) return NextResponse.json({ error: "Pièce introuvable." }, { status: 404 });
  const { data } = await createAdminSupabaseClient().storage.from("fine-photos").createSignedUrl(path, 300);
  if (!data?.signedUrl) return NextResponse.json({ error: "Pièce indisponible." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
