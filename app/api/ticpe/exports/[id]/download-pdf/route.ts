import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Same as .../download, but for the PDF file (regenerated whenever a line is reviewed — see app/api/ticpe/export-lines/[id]/route.ts). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ["direction", "exploitation", "comptable"], modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const supabase = await createServerSupabaseClient();

  const { data: exportRow, error } = await supabase.from("ticpe_exports").select("pdf_file_path").eq("id", id).single();
  if (error || !exportRow?.pdf_file_path) {
    return NextResponse.json({ error: "Export PDF introuvable" }, { status: 404 });
  }

  const { data: signedUrl, error: signError } = await supabase.storage.from("ticpe-exports").createSignedUrl(exportRow.pdf_file_path, 300);
  if (signError || !signedUrl) {
    return NextResponse.json({ error: signError?.message ?? "Échec de génération du lien" }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl.signedUrl);
}
