import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inviteOrganizationMember } from "@/lib/auth/invitations";
import type { VehicleCsvRow, DriverCsvRow } from "@/lib/utils/csv";

export interface BulkImportResult {
  insertedVehicles: number;
  invitationsSent: number;
  invitationFailures: { email: string; error: string }[];
}

/**
 * Bulk-creates vehicles directly, and sends Supabase Auth invitations
 * for drivers/managers — driver accounts can't be inserted straight
 * into `users` because that row is keyed by a real Supabase Auth user
 * id, which only exists once the invitee accepts (see
 * lib/auth/provisioning.ts). Shared by the onboarding import step and
 * the ongoing admin import page (app/(dashboard)/admin/import) so a
 * company doesn't only get one shot at this during signup.
 */
export async function bulkImportVehiclesAndDrivers(
  supabase: SupabaseClient,
  organizationId: string,
  vehicles: VehicleCsvRow[],
  drivers: DriverCsvRow[],
): Promise<BulkImportResult> {
  const serviceNames = new Set(
    [...vehicles.map((v) => v.service), ...drivers.map((d) => d.service)].filter(Boolean),
  );
  const serviceIdByName = new Map<string, string>();

  for (const name of serviceNames) {
    const { data: existing } = await supabase
      .from("services")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      serviceIdByName.set(name, existing.id);
      continue;
    }

    const { data: created, error } = await supabase
      .from("services")
      .insert({ organization_id: organizationId, name })
      .select("id")
      .single();
    if (error) {
      throw new Error(`Impossible de créer le service "${name}": ${error.message}`);
    }
    serviceIdByName.set(name, created.id);
  }

  let insertedVehicles = 0;
  if (vehicles.length > 0) {
    const { error, count } = await supabase
      .from("vehicles")
      .insert(
        vehicles.map((v) => ({
          organization_id: organizationId,
          registration: v.registration,
          type: v.type,
          tank_capacity_liters: v.tank_capacity_liters ?? null,
          service_id: v.service ? serviceIdByName.get(v.service) ?? null : null,
        })),
        { count: "exact" },
      );
    if (error) {
      throw new Error(`Import véhicules échoué: ${error.message}`);
    }
    insertedVehicles = count ?? vehicles.length;
  }

  const invitationResults = await Promise.allSettled(
    drivers.map((d) =>
      inviteOrganizationMember({
        email: d.email,
        fullName: d.full_name,
        role: d.role,
        organizationId,
        serviceId: d.service ? serviceIdByName.get(d.service) : undefined,
      }),
    ),
  );

  const invitationFailures = invitationResults
    .map((res, i) => ({ res, email: drivers[i]?.email }))
    .filter((x): x is { res: PromiseRejectedResult; email: string } => x.res.status === "rejected")
    .map((x) => ({ email: x.email, error: String(x.res.reason) }));

  return {
    insertedVehicles,
    invitationsSent: invitationResults.length - invitationFailures.length,
    invitationFailures,
  };
}
