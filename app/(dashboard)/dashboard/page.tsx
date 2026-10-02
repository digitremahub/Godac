import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { PageHeader, StatTile, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { RoleGate } from "@/components/layout/RoleGate";
import Link from "next/link";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";
import type { UserRole } from "@/lib/types/domain";

const MANAGER_LIKE_ROLES: UserRole[] = ["manager", "manager_chauffeur", "direction"];

export default async function DashboardPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const isDriver = hasRole(appUser.role, ["chauffeur", "manager_chauffeur"]);
  const isManagerLike = hasRole(appUser.role, MANAGER_LIKE_ROLES);

  const [vehiclesRes, openAlertsRes, pendingOcrRes, recentEntriesRes, openTourRes, fleetVehiclesRes] = await Promise.all([
    supabase.from("vehicles").select("id", { count: "exact", head: true }),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("fuel_entries")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending_ocr", "awaiting_validation"]),
    supabase
      .from("fuel_entries")
      .select("id, occurred_at, liters, unit_price, status, vehicles(registration)")
      .order("occurred_at", { ascending: false })
      .limit(6),
    isDriver
      ? supabase
          .from("planning_entries")
          .select("id, tour_number, start_at, vehicles(registration)")
          .eq("driver_id", appUser.id)
          .eq("status", "in_progress")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    isManagerLike
      ? supabase.from("vehicles").select("id, registration").eq("status", "active")
      : Promise.resolve({ data: null }),
  ]);
  const openTour = openTourRes.data as { id: string; tour_number: string; start_at: string; vehicles: { registration: string } | null } | null;

  const consumptionRanking = isManagerLike
    ? (
        await Promise.all(
          ((fleetVehiclesRes.data ?? []) as { id: string; registration: string }[]).map(async (v) => ({
            registration: v.registration,
            consumption: await getVehicleConsumption(supabase, v.id, 30),
          })),
        )
      )
        .filter((v): v is { registration: string; consumption: number } => v.consumption !== null)
        .sort((a, b) => b.consumption - a.consumption)
        .slice(0, 5)
    : [];

  return (
    <div>
      <PageHeader
        title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`}
        description="Vue d'ensemble de votre flotte et de votre consommation carburant."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Véhicules" value={String(vehiclesRes.count ?? 0)} />
        <StatTile label="Alertes ouvertes" value={String(openAlertsRes.count ?? 0)} accent="orange" />
        <StatTile label="Tickets OCR en attente" value={String(pendingOcrRes.count ?? 0)} accent="gold" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg">Derniers ravitaillements</h2>
            <Link href="/fuel" className="text-sm text-teal-ink hover:underline">
              Voir tout
            </Link>
          </div>
          {!recentEntriesRes.data || recentEntriesRes.data.length === 0 ? (
            <EmptyState
              title="Aucun ravitaillement enregistré"
              description="Les ravitaillements saisis manuellement ou via OCR apparaîtront ici."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-navy/40">
                  <tr>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Véhicule</th>
                    <th className="pb-2">Litres</th>
                    <th className="pb-2">Prix/L</th>
                    <th className="pb-2">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEntriesRes.data.map((entry: any) => (
                    <tr key={entry.id} className="border-t border-navy/5">
                      <td className="py-2">{new Date(entry.occurred_at).toLocaleDateString("fr-FR")}</td>
                      <td className="py-2">{entry.vehicles?.registration ?? "—"}</td>
                      <td className="py-2">{entry.liters} L</td>
                      <td className="py-2">{entry.unit_price} €</td>
                      <td className="py-2">
                        <StatusBadge status={entry.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <RoleGate role={appUser.role} allow={MANAGER_LIKE_ROLES}>
          <Card>
            <h2 className="mb-3 text-lg">Consommation (30 jours)</h2>
            {consumptionRanking.length === 0 ? (
              <p className="text-sm text-navy/40">Pas assez de données pour établir un classement.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {consumptionRanking.map((v) => (
                  <li key={v.registration} className="flex items-center justify-between rounded-lg bg-navy/5 px-3 py-2">
                    <span>{v.registration}</span>
                    <span className="font-medium">{v.consumption} L/100km</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </RoleGate>

        <RoleGate role={appUser.role} allow={["chauffeur", "manager_chauffeur"]}>
          <div className="flex flex-col items-center gap-4">
            <Card className="w-full text-center">
              {openTour ? (
                <>
                  <p className="mb-1 text-sm text-navy/60">
                    Tournée n°{openTour.tour_number} en cours
                    {openTour.vehicles ? ` — ${openTour.vehicles.registration}` : ""}
                  </p>
                  <p className="mb-3 text-xs text-navy/40">
                    Départ à {new Date(openTour.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <Link href="/tours/end" className="btn-primary block w-full text-center">
                    🏁 Terminer la tournée
                  </Link>
                </>
              ) : (
                <>
                  <p className="mb-3 text-sm text-navy/60">Aucune tournée en cours</p>
                  <Link href="/tours/start" className="btn-primary block w-full text-center">
                    🚚 Démarrer une tournée
                  </Link>
                </>
              )}
              <Link href="/planning/mine" className="mt-2 block text-xs text-teal-ink hover:underline">
                Voir mon planning →
              </Link>
            </Card>
            <QrCodeBadge
              type="driver"
              id={appUser.id}
              title={appUser.full_name}
              subtitle="Mon badge chauffeur — à présenter à la pompe"
            />
          </div>
        </RoleGate>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    manual: "badge-neutral",
    validated: "badge-teal",
    pending_ocr: "badge-gold",
    awaiting_validation: "badge-gold",
    ocr_failed: "badge-orange",
  };
  const labels: Record<string, string> = {
    manual: "Manuel",
    validated: "Validé",
    pending_ocr: "OCR en cours",
    awaiting_validation: "À valider",
    ocr_failed: "Échec OCR",
  };
  return <span className={map[status] ?? "badge-neutral"}>{labels[status] ?? status}</span>;
}
