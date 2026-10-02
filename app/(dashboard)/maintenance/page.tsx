import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { MaintenanceRequestForm } from "@/components/maintenance/MaintenanceRequestForm";
import { MaintenanceRequestsList } from "@/components/maintenance/MaintenanceRequestsList";

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string }>;
}) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { vehicle } = await searchParams;

  const maintenanceEnabled = await isModuleEnabled(supabase, appUser.organization_id, "maintenance_requests");
  if (!maintenanceEnabled) {
    return (
      <EmptyState
        title="Module Demandes d'Entretien non activé"
        description="Activez-le depuis les paramètres de votre organisation."
      />
    );
  }

  const [{ data: vehicles }, { data: requests }] = await Promise.all([
    supabase.from("vehicles").select("id, registration").eq("status", "active").order("registration"),
    supabase
      .from("vehicle_interventions")
      .select(
        "id, type, description, urgency, status, created_at, vehicles(registration), users!vehicle_interventions_requested_by_fkey(full_name)",
      )
      .order("created_at", { ascending: false }),
  ]);

  const rows = (requests ?? []) as any[];
  rows.sort((a, b) => (URGENCY_RANK[a.urgency] ?? 2) - (URGENCY_RANK[b.urgency] ?? 2));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Demandes d'entretien"
        description="Signalement chauffeur → gestionnaire, avec niveau d'urgence."
      />

      <MaintenanceRequestForm vehicles={vehicles ?? []} initialVehicleId={vehicle} />

      <MaintenanceRequestsList
        requests={rows.map((r) => ({
          id: r.id,
          vehicleRegistration: r.vehicles?.registration ?? "—",
          type: r.type,
          description: r.description,
          urgency: r.urgency,
          status: r.status,
          requesterName: r.users?.full_name ?? "—",
          createdAt: r.created_at,
        }))}
        canManage={hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])}
      />
    </div>
  );
}
