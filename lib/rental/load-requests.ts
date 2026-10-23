import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RentalRequestStatus } from "@/lib/rental/workflow";
import { contexteHierarchie, rolesParId } from "@/lib/hierarchie/serveur";
import { droitsDecision } from "@/lib/hierarchie/demandes";

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
  /** Hiérarchie des demandes : faux si la demande d'entretien d'origine est celle de la personne connectée, ou d'un rang égal ou supérieur. */
  peutDecider?: boolean;
  mention?: string | null;
}

/** Demandes au loueur (RLS : responsables de l'organisation), avec historique et liens signés des factures (10 min). */
export async function loadRentalRequests(
  supabase: SupabaseClient,
  filters: { status?: string; providerId?: string; vehicleId?: string } = {},
  limit = 200,
  /** Personne connectée : calcule qui peut valider (la demande d'entretien d'origine n'est pas la sienne). */
  acteur?: { id: string; role: string; organizationId: string },
): Promise<RentalRequestView[]> {
  let q = supabase
    .from("rental_maintenance_requests")
    .select(
      "id, status, vehicle_id, created_at, validated_at, refusal_reason, transmitted_at, slot_start, slot_end, completed_at, last_provider_comment, invoice_paths, token_expires_at, vehicles(registration), rental_providers(name, maintenance_emails), vehicle_interventions(type, description, urgency, created_at, requested_by), validator:users!rental_maintenance_requests_validated_by_fkey(full_name), rental_request_events(action, actor_kind, comment, created_at, users(full_name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.providerId) q = q.eq("provider_id", filters.providerId);
  if (filters.vehicleId) q = q.eq("vehicle_id", filters.vehicleId);
  const { data } = await q;

  const hierarchie = acteur
    ? {
        ...(await contexteHierarchie(supabase, acteur.organizationId)),
        roles: await rolesParId(supabase, acteur.organizationId, ((data ?? []) as any[]).map((r) => r.vehicle_interventions?.requested_by).filter(Boolean)),
      }
    : null;

  return Promise.all(
    ((data ?? []) as any[]).map(async (r) => {
      const invoiceUrls = (
        await Promise.all(
          ((r.invoice_paths ?? []) as string[]).map(async (p) => (await supabase.storage.from("rental-invoices").createSignedUrl(p, 600)).data?.signedUrl ?? null),
        )
      ).filter((u): u is string => Boolean(u));
      const demandeur: string | null = r.vehicle_interventions?.requested_by ?? null;
      const droits = acteur && hierarchie && demandeur
        ? droitsDecision({ moi: { id: acteur.id, role: acteur.role }, demandeur: { id: demandeur, role: hierarchie.roles.get(demandeur) ?? "chauffeur" }, directionCount: hierarchie.directionCount })
        : null;
      return {
        peutDecider: droits ? droits.peutDecider : true,
        mention: droits?.mention ?? null,
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
