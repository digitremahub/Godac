import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { findOverlappingLeaves } from "@/lib/business/leave-overlap";
import { PageHeader, EmptyState } from "@/components/ui";
import { LeaveRequestForm } from "@/components/leaves/LeaveRequestForm";
import { LeaveRequestsList } from "@/components/leaves/LeaveRequestsList";

export default async function LeavesPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const leaveEnabled = await isModuleEnabled(supabase, appUser.organization_id, "leave_management");
  if (!leaveEnabled) {
    return (
      <EmptyState
        title="Module Congés & Absences non activé"
        description="Activez-le depuis les paramètres de votre organisation pour permettre les demandes de congés."
      />
    );
  }

  const isDecisionMaker = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);

  const [{ data: myServices }, { data: leaves }] = await Promise.all([
    supabase.from("user_services").select("services(id, name)").eq("user_id", appUser.id),
    supabase
      .from("leave_requests")
      .select("id, driver_id, service_id, start_date, end_date, status, reason, created_at, users!leave_requests_driver_id_fkey(full_name), services(name)")
      .order("start_date", { ascending: false }),
  ]);

  const serviceOptions = (myServices ?? [])
    .map((row: any) => row.services)
    .filter((s: any): s is { id: string; name: string } => Boolean(s));

  const rows = (leaves ?? []) as any[];
  const driverNameById = new Map(rows.map((r) => [r.driver_id, r.users?.full_name ?? "—"]));
  const overlapsByLeaveId = new Map<string, string[]>();
  if (isDecisionMaker) {
    for (const leave of rows) {
      if (leave.status !== "pending") continue;
      const sameService = rows.filter((r) => r.service_id === leave.service_id && r.id !== leave.id);
      const overlaps = findOverlappingLeaves(
        { driverId: leave.driver_id, startDate: leave.start_date, endDate: leave.end_date },
        sameService.map((r) => ({ driverId: r.driver_id, startDate: r.start_date, endDate: r.end_date })),
      );
      if (overlaps.length > 0) {
        const names = Array.from(new Set(overlaps.map((o) => driverNameById.get(o.driverId) ?? "—")));
        overlapsByLeaveId.set(leave.id, names);
      }
    }
  }

  return (
    <div>
      <PageHeader
        title="Congés & Absences"
        description="Demandes de congés avec détection de chevauchement au sein d'un même service."
      />

      <div className="mb-6">
        <LeaveRequestForm services={serviceOptions} />
      </div>

      <LeaveRequestsList
        leaves={rows.map((r) => ({
          id: r.id,
          driverName: r.users?.full_name ?? "—",
          serviceName: r.services?.name ?? "—",
          startDate: r.start_date,
          endDate: r.end_date,
          status: r.status,
          reason: r.reason,
          isOwn: r.driver_id === appUser.id,
          overlapWith: overlapsByLeaveId.get(r.id) ?? [],
        }))}
        canDecide={isDecisionMaker}
      />
    </div>
  );
}
