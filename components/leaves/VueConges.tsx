import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { findOverlappingLeaves } from "@/lib/business/leave-overlap";
import { PageHeader } from "@/components/ui";
import { LeaveRequestForm } from "@/components/leaves/LeaveRequestForm";
import { LeaveRequestsList } from "@/components/leaves/LeaveRequestsList";
import { soldesConges } from "@/lib/paie/conges-serveur";
import { joursOuvrables } from "@/lib/paie/conges";

/**
 * Congés : Équipe › Congés (encadrement : décisions sur son service, avec
 * détection de chevauchement) et Mon espace › Mes congés (ses demandes).
 */
export async function VueConges({ appUser, supabase, decision }: { appUser: AppUser; supabase: SupabaseClient; decision: boolean }) {
  const isDecisionMaker = decision;

  const [{ data: myServices }, { data: leaves }] = await Promise.all([
    supabase.from("user_services").select("services(id, name)").eq("user_id", appUser.id),
    supabase
      .from("leave_requests")
      .select("id, driver_id, service_id, start_date, end_date, status, reason, created_at, users!leave_requests_driver_id_fkey(full_name), services(name)")
      .order("start_date", { ascending: false })
      // Mes congés : ses propres demandes, même pour un manager.
      .match(decision ? {} : { driver_id: appUser.id }),
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

  // Soldes de congés payés (N-1 / N) : le sien pour le formulaire, ceux
  // des demandeurs pour la décision. Une demande en attente est comparée
  // au solde sans elle (les autres demandes en attente comptent).
  const aujourdhui = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const soldes = await soldesConges(supabase, appUser.organization_id, [appUser.id, ...(isDecisionMaker ? rows.map((r) => r.driver_id as string) : [])], aujourdhui);
  const monSolde = soldes.get(appUser.id) ?? null;
  const soldeLigne = (r: any) => {
    const s = soldes.get(r.driver_id);
    if (!s) return null;
    const jours = joursOuvrables(r.start_date, r.end_date);
    const sansElle = s.disponibleApresAttente + (r.status === "pending" ? jours : 0);
    return { disponible: s.disponible, jours, insuffisant: r.status === "pending" && sansElle - jours < 0 };
  };

  return (
    <div>
      <PageHeader
        title={decision ? "Congés & absences" : "Mes congés"}
        description={decision ? "Demandes de congés avec détection de chevauchement au sein d'un même service." : "Vos demandes de congés et leur statut."}
      />

      <div className="mb-6">
        <LeaveRequestForm services={serviceOptions} solde={monSolde} />
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
          solde: soldeLigne(r),
        }))}
        canDecide={isDecisionMaker}
      />
    </div>
  );
}
