import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer } from "@/lib/usage/consommer";
import { isModuleEnabled } from "@/lib/organization/modules";
import { lireContestation } from "@/lib/contestations/lecture";
import { suggererChauffeur } from "@/lib/contestations/rattachement";

export const maxDuration = 60;

const bodySchema = z.object({
  /** Document déjà déposé dans le bucket dispute-docs (dossier de l'organisation). */
  document_path: z.string().min(1).max(300).nullable().optional(),
  client_name: z.string().trim().max(200).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
});

/**
 * Crée une contestation « à valider ». Si un document est joint et que
 * la lecture automatique est active, il est lu par OCR pour préremplir
 * les champs, puis un chauffeur est suggéré — rien n'est attribué ni
 * notifié avant la validation humaine.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["customer_disputes"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) return NextResponse.json({ error: "Réservé à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "customer_disputes"))) return NextResponse.json({ error: "Module Contestations clients non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const path = parsed.data.document_path ?? null;
  if (path && !path.startsWith(`${appUser.organization_id}/`)) return NextResponse.json({ error: "Document invalide." }, { status: 403 });

  let champs: Record<string, unknown> = { client_name: parsed.data.client_name ?? null, reason: parsed.data.reason ?? null };
  let lecture: "ok" | "desactivee" | "echec" | null = null;
  let lectureErreur: string | null = null;
  if (path) {
    if (await isModuleEnabled(supabase, appUser.organization_id, "ocr")) {
      const { data: blob } = await supabase.storage.from("dispute-docs").download(path);
      const quota = blob ? await consommer(createAdminSupabaseClient(), appUser.organization_id, appUser.id, "contestation") : null;
      if (quota && !quota.ok) {
        lecture = "echec";
        lectureErreur = quota.raison;
      } else if (blob) {
        const mediaType = path.endsWith(".pdf") ? "application/pdf" : path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
        const r = await lireContestation(Buffer.from(await blob.arrayBuffer()), mediaType);
        if (r.ok) {
          champs = { ...r.champs, client_name: r.champs.client_name ?? champs.client_name, reason: r.champs.reason ?? champs.reason };
          lecture = "ok";
        } else lecture = "echec";
      } else lecture = "echec";
    } else lecture = "desactivee";
  }

  const suggestion = await suggererChauffeur(supabase, appUser.organization_id, {
    parcel_code: (champs.parcel_code as string) ?? null,
    delivery_address: (champs.delivery_address as string) ?? null,
    delivery_date: (champs.delivery_date as string) ?? null,
    tour_number: (champs.tour_number as string) ?? null,
  });

  const { data, error } = await supabase
    .from("customer_disputes")
    .insert({
      organization_id: appUser.organization_id,
      document_path: path,
      ...champs,
      suggested_driver_id: suggestion?.driverId ?? null,
      suggestion_reason: suggestion?.raison ?? null,
      delivery_stop_id: suggestion?.stopId ?? null,
      created_by: appUser.id,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, lecture, lectureErreur, suggestion });
}
