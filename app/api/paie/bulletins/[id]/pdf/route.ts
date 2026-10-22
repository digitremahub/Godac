import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { nomFichier } from "@/lib/paie/csv";

/**
 * Télécharge UN bulletin en PDF (« Bulletin 2026-09 - Nom.pdf »). Le
 * bulletin est relu avec le client de l'utilisateur : la RLS de
 * « payslips » et du bucket décide (le salarié : ses bulletins validés ;
 * direction et comptable : ceux de l'entreprise). Le lien signé est créé
 * à chaque clic, il n'expire donc jamais pour l'utilisateur.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: "tous", modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { supabase } = g;
  const { id } = await params;
  const { data: b } = await supabase
    .from("payslips")
    .select("id, period_start, file_path, users!payslips_user_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!b?.file_path) return NextResponse.json({ error: "Bulletin introuvable." }, { status: 404 });
  const nom = (b.users as unknown as { full_name: string | null } | null)?.full_name ?? "salarie";
  const fichier = `Bulletin ${String(b.period_start).slice(0, 7)} - ${nomFichier(nom)}.pdf`;
  const { data, error } = await supabase.storage.from("payslips").createSignedUrl(b.file_path, 60, { download: fichier });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Fichier du bulletin indisponible." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
