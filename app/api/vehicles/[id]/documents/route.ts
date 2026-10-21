import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { VEHICLE_DOC_TYPES } from "@/lib/vehicles/documents";

const bodySchema = z.object({
  docType: z.enum(VEHICLE_DOC_TYPES),
  filePath: z.string().min(1),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  driverVisible: z.boolean(),
});

/** Records a vehicle document once its file is uploaded (see ./init). Manager-like only — RLS enforces it too. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Réservé à l'exploitation." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!parsed.data.filePath.startsWith(`${appUser.organization_id}/${id}/`)) {
    return NextResponse.json({ error: "Chemin de fichier invalide." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("vehicle_documents").insert({
    organization_id: appUser.organization_id,
    vehicle_id: id,
    doc_type: parsed.data.docType,
    file_path: parsed.data.filePath,
    expires_on: parsed.data.expiresOn ?? null,
    driver_visible: parsed.data.driverVisible,
    uploaded_by: appUser.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
