import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { NewFineForm } from "@/components/fines/NewFineForm";
import { FinesTable, type FineRow } from "@/components/fines/FinesTable";

/**
 * Direction-only — same sensitivity class as /payroll (attributing a
 * fine to a specific employee). See app/api/fines for the create/
 * confirm/notify routes this page's components call.
 */
export default async function FinesPage() {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    redirect("/dashboard");
  }

  const supabase = await createServerSupabaseClient();
  const finesEnabled = await isModuleEnabled(supabase, appUser.organization_id, "fines");
  if (!finesEnabled) {
    return (
      <EmptyState
        title="Module Amendes non activé"
        description="Activez-le depuis les paramètres de votre organisation pour suivre les amendes par véhicule."
      />
    );
  }

  const [{ data: vehicles }, { data: finesData }] = await Promise.all([
    supabase.from("vehicles").select("id, registration").order("registration"),
    supabase
      .from("fines")
      .select(
        "id, infraction_at, amount, reference, status, notified_at, vehicles(registration), driver:users!fines_driver_id_fkey(full_name), matched:planning_entries!fines_matched_planning_entry_id_fkey(tour_number, users!planning_entries_driver_id_fkey(full_name))",
      )
      .order("infraction_at", { ascending: false })
      .limit(200),
  ]);

  const fines: FineRow[] = (finesData ?? []).map((f: any) => ({
    id: f.id,
    infraction_at: f.infraction_at,
    amount: Number(f.amount),
    reference: f.reference,
    status: f.status,
    notified_at: f.notified_at,
    vehicles: f.vehicles,
    driver: f.driver,
    suggested_driver_name: f.matched?.users?.full_name ?? null,
    suggested_tour_number: f.matched?.tour_number ?? null,
  }));

  return (
    <div>
      <PageHeader
        title="Amendes"
        description="Rattachement suggéré au chauffeur via le planning du véhicule — à confirmer avant notification."
      />
      <div className="mb-4">
        <NewFineForm vehicles={vehicles ?? []} />
      </div>
      {fines.length === 0 ? (
        <EmptyState title="Aucune amende" description="Les amendes enregistrées apparaîtront ici." />
      ) : (
        <FinesTable fines={fines} />
      )}
    </div>
  );
}
