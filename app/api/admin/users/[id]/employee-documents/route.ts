import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const DOC_TYPES = [
  "Contrat de travail",
  "Avenant au contrat",
  "Pièce d'identité",
  "Titre de séjour / autorisation de travail",
  "Permis de conduire",
  "Visite médicale (aptitude)",
  "Diplôme / certification",
  "Autre",
] as const;

const bodySchema = z.object({
  employeeFileId: z.string().uuid(),
  docType: z.enum(DOC_TYPES),
  filePath: z.string().min(1),
});

/** Records the metadata row once the browser has finished uploading to the employee-documents bucket — see init/route.ts. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ["direction"], modules: ["employee_files"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.filePath.startsWith(`${appUser.organization_id}/${id}/`)) {
    return NextResponse.json({ error: "Chemin de fichier invalide." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("employee_documents").insert({
    organization_id: appUser.organization_id,
    employee_file_id: parsed.data.employeeFileId,
    doc_type: parsed.data.docType,
    file_path: parsed.data.filePath,
    uploaded_by: appUser.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
