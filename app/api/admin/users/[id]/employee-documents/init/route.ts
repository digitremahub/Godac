import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const bodySchema = z.object({ contentType: z.string().optional() });

/**
 * Storage-path issuer for an employee document (contrat, pièce
 * d'identité, visite médicale...) — same init/upload/confirm shape as
 * app/api/ocr/tour-report/init. Also ensures an employee_files row
 * exists for this user (a document can be the very first thing
 * direction attaches, before ever touching the "Dossier RH" form),
 * so the follow-up POST always has a valid employee_file_id to
 * attach to.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ["direction"], modules: ["employee_files"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const contentType = parsed.success ? parsed.data.contentType : undefined;
  const ext = (contentType && EXTENSION_BY_CONTENT_TYPE[contentType]) || "jpg";

  const supabase = await createServerSupabaseClient();
  const { data: target, error: targetError } = await supabase
    .from("users")
    .select("id")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .single();
  if (targetError || !target) {
    return NextResponse.json({ error: "Chauffeur introuvable." }, { status: 404 });
  }

  const { data: existingFile } = await supabase.from("employee_files").select("id").eq("user_id", id).maybeSingle();
  let employeeFileId = existingFile?.id as string | undefined;
  if (!employeeFileId) {
    const { data: created, error: createError } = await supabase
      .from("employee_files")
      .insert({ organization_id: appUser.organization_id, user_id: id })
      .select("id")
      .single();
    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });
    employeeFileId = created.id;
  }

  const storagePath = `${appUser.organization_id}/${id}/${randomUUID()}.${ext}`;
  return NextResponse.json({ storagePath, employeeFileId });
}
