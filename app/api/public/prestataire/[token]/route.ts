import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { resolveProviderAccess } from "@/lib/rental/public-access";
import { invoiceStoragePath, validateInvoiceFile } from "@/lib/rental/invoice";
import { nextStatusAfterProvider, PROVIDER_ACTION_LABELS, RENTAL_STATUS_LABELS, type RentalRequestStatus } from "@/lib/rental/workflow";
import { addRentalEvent } from "@/lib/rental/server";

export const dynamic = "force-dynamic";

const fieldsSchema = z
  .object({
    action: z.enum(["accepter", "proposer_creneau", "commenter", "terminer"]),
    comment: z.string().trim().max(2000).optional().nullable(),
    slot_start: z.string().datetime().optional().nullable(),
    slot_end: z.string().datetime().optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.action === "proposer_creneau" && !d.slot_start) ctx.addIssue({ code: "custom", message: "Indiquez la date et l'heure proposées.", path: ["slot_start"] });
    if (d.action === "commenter" && !d.comment) ctx.addIssue({ code: "custom", message: "Le commentaire est vide.", path: ["comment"] });
    if (d.slot_start && d.slot_end && Date.parse(d.slot_end) <= Date.parse(d.slot_start)) {
      ctx.addIssue({ code: "custom", message: "La fin du créneau doit suivre son début.", path: ["slot_end"] });
    }
  });

const str = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * Réponse du loueur / prestataire depuis /prestataire/[token], sans
 * compte GODAC : accepter, proposer un créneau, commenter, indiquer
 * l'intervention terminée (avec facture/PDF facultative). Chaque action
 * met à jour la demande et son historique et crée une alerte pour les
 * responsables de l'entreprise.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminSupabaseClient();
  const access = await resolveProviderAccess(admin, token, req.headers, "action");
  if (!access.ok) return NextResponse.json({ error: access.message }, { status: access.httpStatus });
  const request = access.request;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const parsed = fieldsSchema.safeParse({
    action: str(form.get("action")),
    comment: str(form.get("comment")),
    slot_start: str(form.get("slot_start")),
    slot_end: str(form.get("slot_end")),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Champs invalides." }, { status: 400 });
  const d = parsed.data;

  const status = request.status as RentalRequestStatus;
  const hasSlot = Boolean(d.slot_start);
  const next = nextStatusAfterProvider(status, d.action, { hasSlot });
  if (!next) {
    return NextResponse.json({ error: `Cette demande est « ${RENTAL_STATUS_LABELS[status] ?? status} » : action impossible.` }, { status: 409 });
  }

  // Facture / compte rendu (facultatif) : type, signature et taille contrôlés.
  let invoicePath: string | null = null;
  const file = form.get("file");
  if (file && typeof file !== "string" && file.size > 0) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const check = validateInvoiceFile({ declaredType: file.type, size: file.size, head: buf.subarray(0, 16) });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    invoicePath = invoiceStoragePath(request.organization_id, request.id, randomUUID(), check.extension);
    const { error: upErr } = await admin.storage.from("rental-invoices").upload(invoicePath, buf, { contentType: check.mime, upsert: false });
    if (upErr) return NextResponse.json({ error: "Le dépôt du fichier a échoué, réessayez." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { data: current } = await admin.from("rental_maintenance_requests").select("invoice_paths").eq("id", request.id).single();
  const patch: Record<string, unknown> = { status: next, updated_at: now };
  if (d.comment) patch.last_provider_comment = d.comment;
  if (d.action === "accepter") patch.provider_accepted_at = now;
  if (hasSlot) Object.assign(patch, { slot_start: d.slot_start, slot_end: d.slot_end ?? null });
  if (d.action === "terminer") patch.completed_at = now;
  if (invoicePath) patch.invoice_paths = [...((current?.invoice_paths as string[] | null) ?? []), invoicePath];

  const { data: updated, error } = await admin
    .from("rental_maintenance_requests")
    .update(patch)
    .eq("id", request.id)
    .eq("status", status)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Enregistrement impossible, réessayez." }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "La demande a été modifiée entre-temps, rechargez la page." }, { status: 409 });

  // Répercussion sur l'intervention elle-même (planning et historique véhicule).
  if (hasSlot) await admin.from("vehicle_interventions").update({ scheduled_at: d.slot_start }).eq("id", request.intervention_id);
  if (d.action === "terminer") await admin.from("vehicle_interventions").update({ status: "done", completed_at: now }).eq("id", request.intervention_id);

  await addRentalEvent(admin, {
    organization_id: request.organization_id,
    request_id: request.id,
    actor_kind: "prestataire",
    action: d.action,
    status_from: status,
    status_to: next,
    comment: [d.comment, hasSlot ? `Créneau : ${d.slot_start}${d.slot_end ? ` → ${d.slot_end}` : ""}` : null].filter(Boolean).join(" — ") || null,
  });
  if (invoicePath) {
    await addRentalEvent(admin, { organization_id: request.organization_id, request_id: request.id, actor_kind: "prestataire", action: "facture", comment: "Document déposé" });
  }

  const [{ data: provider }, { data: vehicle }] = await Promise.all([
    request.provider_id ? admin.from("rental_providers").select("name").eq("id", request.provider_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("vehicles").select("registration, service_id").eq("id", request.vehicle_id).maybeSingle(),
  ]);
  const slotText = hasSlot
    ? ` le ${new Date(d.slot_start!).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}`
    : "";
  await admin.from("alerts").insert({
    organization_id: request.organization_id,
    type: "rental_request",
    severity: "info",
    message: `${provider?.name ?? "Le prestataire"} ${PROVIDER_ACTION_LABELS[d.action]}${slotText} — ${vehicle?.registration ?? "véhicule"}${invoicePath ? " (facture jointe)" : ""}.`,
    related_table: "rental_maintenance_requests",
    related_id: request.id,
    recipient_roles: ["manager", "direction"],
    service_id: vehicle?.service_id ?? null,
  });

  return NextResponse.json({ ok: true, status: next });
}
