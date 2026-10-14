import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RentalRequestStatus } from "@/lib/rental/workflow";

export interface RentalRequestView {
  id: string;
  status: RentalRequestStatus;
  vehicleId: string;
  registration: string;
  providerName: string;
  providerHasEmail: boolean;
  type: string;
  description: string | null;
  urgency: string;
  createdAt: string;
  validatedBy: string | null;
  validatedAt: string | null;
  refusalReason: string | null;
  transmittedAt: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  completedAt: string | null;
  lastProviderComment: string | null;
  invoiceUrls: string[];
  tokenExpiresAt: string | null;
  events: { action: string; actorKind: string; actorName: string | null; comment: string | null; createdAt: string }[];
}

/** Demandes au loueur (RLS : responsables de l'organisation), avec historique et liens signés des factures (10 min). */
export async function loadRentalRequests(
  supabase: SupabaseClient,
  filters: { status?: string; providerId?: string; vehicleId?: string } = {},
  limit = 200,
): Promise<RentalRequestView[]> {
  let q = supabase
    .from("rental_maintenance_requests")
    .select(
      "id, status, vehicle_id, created_at, validated_at, refusal_reason, transmitted_at, slot_start, slot_end, completed_at, last_provider_comment, invoice_paths, token_expires_at, vehicles(registration), rental_providers(name, maintenance_emails), vehicle_interventions(type, description, urgency, created_at), validator:users!rental_maintenance_requests_validated_by_fkey(full_name), rental_request_events(action, actor_kind, comment, created_at, users(full_name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.providerId) q = q.eq("provider_id", filters.providerId);
  if (filters.vehicleId) q = q.eq("vehicle_id", filters.vehicleId);
  const { data } = await q;

  return Promise.all(
    ((data ?? []) as any[]).map(async (r) => {
      const invoiceUrls = (
        await Promise.all(
          ((r.invoice_paths ?? []) as string[]).map(async (p) => (await supabase.storage.from("rental-invoices").createSignedUrl(p, 600)).data?.signedUrl ?? null),
        )
      ).filter((u): u is string => Boolean(u));
      return {
        id: r.id,
        status: r.status,
        vehicleId: r.vehicle_id,
        registration: r.vehicles?.registration ?? "—",
        providerName: r.rental_providers?.name ?? "—",
        providerHasEmail: (r.rental_providers?.maintenance_emails?.length ?? 0) > 0,
        type: r.vehicle_interventions?.type ?? "Entretien",
        description: r.vehicle_interventions?.description ?? null,
        urgency: r.vehicle_interventions?.urgency ?? "normal",
        createdAt: r.vehicle_interventions?.created_at ?? r.created_at,
        validatedBy: r.validator?.full_name ?? null,
        validatedAt: r.validated_at,
        refusalReason: r.refusal_reason,
        transmittedAt: r.transmitted_at,
        slotStart: r.slot_start,
        slotEnd: r.slot_end,
        completedAt: r.completed_at,
        lastProviderComment: r.last_provider_comment,
        invoiceUrls,
        tokenExpiresAt: r.token_expires_at,
        events: ((r.rental_request_events ?? []) as any[])
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((e) => ({ action: e.action, actorKind: e.actor_kind, actorName: e.users?.full_name ?? null, comment: e.comment, createdAt: e.created_at })),
      } satisfies RentalRequestView;
    }),
  );
}
