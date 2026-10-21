import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Re-signs a download URL for a previously generated TICPE export (the original link expires after 5 minutes). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ["direction", "exploitation", "comptable"], modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const supabase = await createServerSupabaseClient();

  const { data: exportRow, error } = await supabase
    .from("ticpe_exports")
    .select("file_path")
    .eq("id", id)
    .single();

  if (error || !exportRow) {
    return NextResponse.json({ error: "Export introuvable" }, { status: 404 });
  }

  const { data: signedUrl, error: signError } = await supabase.storage
    .from("ticpe-exports")
    .createSignedUrl(exportRow.file_path, 300);

  if (signError || !signedUrl) {
    return NextResponse.json({ error: signError?.message ?? "Échec de génération du lien" }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl.signedUrl);
}
