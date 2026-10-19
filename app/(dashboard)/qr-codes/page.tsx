import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";

/**
 * Bulk view of vehicle/driver QR badges for printing or reference —
 * everything else in the app only ever shows ONE badge at a time
 * (a driver's own on /account, a vehicle's own on /v/[id] for
 * whoever's on tour with it right now, a vehicle's on the manager
 * fiche /vehicles/[id]). Direction sees the whole organisation;
 * manager/manager_chauffeur ("chefs d'équipe") see only the vehicles
 * and chauffeurs of their own service(s).
 *
 * This is a narrower read than what RLS itself allows (vehicles/users
 * SELECT policies are organisation-wide, not service-scoped — see
 * 20260101000009_rls_policies.sql) — the service filter below is this
 * page's own query, same "RLS is the hard backstop, finer slicing is
 * an app-level convenience" pattern used elsewhere (e.g. TICPE's
 * PL/SPL-only filter, active-only vehicle dropdowns). Tightening RLS
 * itself to be service-scoped would affect every page that reads
 * vehicles/users org-wide today and is out of scope here.
 */
export default async function QrCodesPage() {
  const g = await garderPage("flotte.badges");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;

  const supabase = await createServerSupabaseClient();
  const isDirection = appUser.role === "direction";

  let serviceIds: string[] | null = null;
  if (!isDirection) {
    const { data: myServices } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
    serviceIds = (myServices ?? []).map((s) => s.service_id);
  }

  const vehiclesQuery = supabase.from("vehicles").select("id, registration, type, status, service_id").order("registration");
  const { data: vehicles } =
    serviceIds !== null
      ? await vehiclesQuery.in("service_id", serviceIds.length > 0 ? serviceIds : ["00000000-0000-0000-0000-000000000000"])
      : await vehiclesQuery;

  let driverIds: string[] | null = null;
  if (serviceIds !== null) {
    const { data: myTeamLinks } = await supabase
      .from("user_services")
      .select("user_id")
      .in("service_id", serviceIds.length > 0 ? serviceIds : ["00000000-0000-0000-0000-000000000000"]);
    driverIds = (myTeamLinks ?? []).map((l) => l.user_id);
  }

  const driversQuery = supabase
    .from("users")
    .select("id, full_name, role, active")
    .in("role", ["chauffeur", "manager_chauffeur"])
    .eq("active", true)
    .order("full_name");
  const { data: drivers } =
    driverIds !== null
      ? await driversQuery.in("id", driverIds.length > 0 ? driverIds : ["00000000-0000-0000-0000-000000000000"])
      : await driversQuery;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Badges QR"
        description={
          isDirection
            ? "Tous les véhicules et chauffeurs de l'organisation."
            : "Les véhicules et chauffeurs de votre service."
        }
      />

      <div>
        <h3 className="mb-3 text-base">Véhicules</h3>
        {!vehicles || vehicles.length === 0 ? (
          <EmptyState title="Aucun véhicule" description="Aucun véhicule à afficher pour votre périmètre." />
        ) : (
          <Card className="flex flex-wrap gap-4">
            {vehicles.map((v) => (
              <QrCodeBadge key={v.id} type="vehicle" id={v.id} title={v.registration} subtitle={v.type} />
            ))}
          </Card>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-base">Chauffeurs</h3>
        {!drivers || drivers.length === 0 ? (
          <EmptyState title="Aucun chauffeur" description="Aucun chauffeur à afficher pour votre périmètre." />
        ) : (
          <Card className="flex flex-wrap gap-4">
            {drivers.map((d) => (
              <QrCodeBadge key={d.id} type="driver" id={d.id} title={d.full_name} />
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
