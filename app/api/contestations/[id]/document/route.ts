import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { pieceCommentaire } from "@/lib/rattachement/commentaires-serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/**
 * Lien temporaire (5 min) vers une pièce de la contestation : document de
 * la réclamation (?i=0, 1…) ou photo d'un échange (?commentaire=<id>&i=0).
 * Accès selon la RLS de customer_disputes : encadrement, ou chauffeur
 * attributaire (après validation). Lien signé par le client service, la
 * lecture directe du bucket étant réservée à l'encadrement.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ modules: ["customer_disputes"] });
  if (!g.ok) return g.reponse;
  const { id } = await params;
  const url = new URL(req.url);
  const index = Math.max(0, Number(url.searchParams.get("i") ?? "0") || 0);
  const commentaire = url.searchParams.get("commentaire");
  const supabase = await createServerSupabaseClient();
  let lecture = await supabase.from("customer_disputes").select("id, document_path, document_paths").eq("id", id).maybeSingle();
  if (lecture.error && estSchemaManquant(lecture.error)) lecture = (await supabase.from("customer_disputes").select("id, document_path").eq("id", id).maybeSingle()) as typeof lecture;
  const c = lecture.data as { id: string; document_path: string | null; document_paths?: string[] | null } | null;
  if (!c) return NextResponse.json({ error: "Contestation introuvable." }, { status: 404 });

  let path: string | null;
  if (commentaire) path = await pieceCommentaire(supabase, "dispute", id, commentaire, index);
  else {
    const docs = (c.document_paths ?? []).filter(Boolean);
    const paths = docs.length ? docs : c.document_path ? [c.document_path] : [];
    path = paths[index] ?? null;
  }
  if (!path) return NextResponse.json({ error: "Aucun document." }, { status: 404 });
  const { data } = await createAdminSupabaseClient().storage.from("dispute-docs").createSignedUrl(path, 300);
  if (!data?.signedUrl) return NextResponse.json({ error: "Document indisponible." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
