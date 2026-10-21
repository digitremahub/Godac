import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer } from "@/lib/usage/consommer";
import { isModuleEnabled } from "@/lib/organization/modules";
import { lireContestation } from "@/lib/contestations/lecture";
import { journaliser } from "@/lib/audit/journal";
import { rechercherResponsableContestation } from "@/lib/rattachement/serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

export const maxDuration = 60;

const chemin = z.string().min(1).max(300);
const bodySchema = z.object({
  /** Documents déjà déposés dans le bucket dispute-docs (dossier de l'organisation) : au moins un. */
  document_paths: z.array(chemin).max(6).optional(),
  /** Historique : un seul document. */
  document_path: chemin.nullable().optional(),
  client_name: z.string().trim().max(200).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
});

const typeMedia = (path: string) => (path.endsWith(".pdf") ? "application/pdf" : path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg");

/**
 * Crée une contestation « à valider » à partir de la réclamation
 * (photo, capture du mail / du ticket transporteur, courrier — plusieurs
 * fichiers possibles, au moins un obligatoire). Le premier document est lu
 * par OCR si la lecture automatique est active, puis l'arrêt de tournée
 * colis et le chauffeur sont recherchés (lib/rattachement) — rien n'est
 * attribué ni notifié avant la validation humaine.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["customer_disputes"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) return NextResponse.json({ error: "Réservé à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "customer_disputes"))) return NextResponse.json({ error: "Module Contestations clients non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const pieces = [...new Set([...(parsed.data.document_paths ?? []), ...(parsed.data.document_path ? [parsed.data.document_path] : [])])];
  if (pieces.length === 0) return NextResponse.json({ error: "Joignez la réclamation (photo, capture ou PDF)." }, { status: 400 });
  if (pieces.some((p) => !p.startsWith(`${appUser.organization_id}/`))) return NextResponse.json({ error: "Document invalide." }, { status: 403 });
  const path = pieces[0]!;

  let champs: Record<string, unknown> = { client_name: parsed.data.client_name ?? null, reason: parsed.data.reason ?? null };
  let lecture: "ok" | "desactivee" | "echec" | null = null;
  let lectureErreur: string | null = null;
  if (await isModuleEnabled(supabase, appUser.organization_id, "ocr")) {
    const { data: blob } = await supabase.storage.from("dispute-docs").download(path);
    const quota = blob ? await consommer(createAdminSupabaseClient(), appUser.organization_id, appUser.id, "contestation") : null;
    if (quota && !quota.ok) {
      lecture = "echec";
      lectureErreur = quota.raison;
    } else if (blob) {
      const r = await lireContestation(Buffer.from(await blob.arrayBuffer()), typeMedia(path));
      if (r.ok) {
        champs = { ...r.champs, client_name: r.champs.client_name ?? champs.client_name, reason: r.champs.reason ?? champs.reason };
        lecture = "ok";
      } else lecture = "echec";
    } else lecture = "echec";
  } else lecture = "desactivee";

  const recherche = await rechercherResponsableContestation(supabase, appUser.organization_id, {
    parcelCode: (champs.parcel_code as string) ?? null,
    deliveryAddress: (champs.delivery_address as string) ?? null,
    recipient: null,
    deliveryDate: (champs.delivery_date as string) ?? null,
    tourNumber: (champs.tour_number as string) ?? null,
  });
  const s = recherche.suggestion;

  const base = {
    organization_id: appUser.organization_id,
    document_path: path,
    ...champs,
    suggested_driver_id: s?.driverId ?? null,
    suggestion_reason: s?.raison ?? recherche.details.raison,
    delivery_stop_id: s?.stopId ?? null,
    created_by: appUser.id,
  };
  const complet = {
    ...base,
    document_paths: pieces,
    run_id: s?.runId ?? null,
    planning_entry_id: s?.planningEntryId ?? null,
    match_confidence: recherche.confiance,
    match_details: recherche.details,
    matched_at: new Date().toISOString(),
  };
  let res = await supabase.from("customer_disputes").insert(complet).select("id").single();
  // Migration 20261026000003 non appliquée : colonnes historiques (premier document seulement).
  if (res.error && estSchemaManquant(res.error)) res = await supabase.from("customer_disputes").insert(base).select("id").single();
  if (res.error || !res.data) return NextResponse.json({ error: res.error?.message ?? "Création impossible." }, { status: 500 });

  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "contestation_creee", targetTable: "customer_disputes", targetId: res.data.id, details: { documents: pieces.length, confiance: recherche.confiance } });
  return NextResponse.json({
    id: res.data.id,
    lecture,
    lectureErreur,
    confiance: recherche.confiance,
    suggestion: s ? { driverId: s.driverId, driverName: s.driverName, raison: s.raison } : null,
  });
}
