import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import Link from "next/link";
import { hasRole } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader } from "@/components/ui";
import { MaintenanceRequestForm } from "@/components/maintenance/MaintenanceRequestForm";
import { MaintenanceRequestsList } from "@/components/maintenance/MaintenanceRequestsList";

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/**
 * Demandes d'entretien : Flotte › Entretien (encadrement, traitement) et
 * Mon espace › Signaler un problème (chauffeur, mêmes formulaire et liste
 * filtrée par la RLS).
 */
export async function VueEntretien({ appUser, supabase, vehicle, titre = "Demandes d'entretien" }: { appUser: AppUser; supabase: SupabaseClient; vehicle?: string; titre?: string }) {
  const [{ data: vehicles }, { data: requests }, { data: organization }] = await Promise.all([
    supabase.from("vehicles").select("id, registration").eq("status", "active").order("registration"),
    supabase
      .from("vehicle_interventions")
      .select(
        "id, type, description, urgency, status, odometer_km, appointment_needed, photo_paths, created_at, vehicles(registration), users!vehicle_interventions_requested_by_fkey(full_name)",
      )
      .order("created_at", { ascending: false }),
    supabase.from("organizations").select("emergency_phone").eq("id", appUser.organization_id).single(),
  ]);

  // Module « Véhicules loués » : rappel des demandes à valider avant transmission au loueur.
  const canManage = hasRole(appUser.role, ["manager", "direction"]);
  const rentalToValidate =
    canManage && (await isModuleEnabled(supabase, appUser.organization_id, "rental_providers"))
      ? ((await supabase.from("rental_maintenance_requests").select("id", { count: "exact", head: true }).eq("status", "a_valider")).count ?? 0)
      : 0;

  const rows = (requests ?? []) as any[];
  rows.sort((a, b) => (URGENCY_RANK[a.urgency] ?? 2) - (URGENCY_RANK[b.urgency] ?? 2));

  const rowsWithPhotos = await Promise.all(
    rows.map(async (r) => {
      const paths: string[] = r.photo_paths ?? [];
      const photoUrls = await Promise.all(
        paths.map(async (path) => {
          const { data } = await supabase.storage.from("intervention-photos").createSignedUrl(path, 600);
          return data?.signedUrl ?? null;
        }),
      );
      return { ...r, photoUrls: photoUrls.filter((u): u is string => Boolean(u)) };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={titre}
        description="Signalement chauffeur → gestionnaire, avec niveau d'urgence."
      />

      {rentalToValidate > 0 && (
        <Link href="/flotte/loueurs?statut=a_valider" className="card flex items-center justify-between gap-3 border-gold/50 text-sm hover:border-gold">
          <span>
            <strong>{rentalToValidate}</strong> demande{rentalToValidate > 1 ? "s" : ""} sur des véhicules loués à valider avant transmission au loueur.
          </span>
          <span className="text-teal-ink">Valider →</span>
        </Link>
      )}

      <MaintenanceRequestForm vehicles={vehicles ?? []} initialVehicleId={vehicle} emergencyPhone={organization?.emergency_phone} />

      <MaintenanceRequestsList
        requests={rowsWithPhotos.map((r) => ({
          id: r.id,
          vehicleRegistration: r.vehicles?.registration ?? "—",
          type: r.type,
          description: r.description,
          urgency: r.urgency,
          status: r.status,
          odometerKm: r.odometer_km,
          appointmentNeeded: r.appointment_needed,
          photoUrls: r.photoUrls,
          requesterName: r.users?.full_name ?? "—",
          createdAt: r.created_at,
        }))}
        canManage={hasRole(appUser.role, ["manager", "direction"])}
      />
    </div>
  );
}
