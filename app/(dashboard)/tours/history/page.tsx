import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { TourHistoryFilters } from "@/components/tours/TourHistoryFilters";
import { addDays, todayISO } from "@/lib/planning/dates";

const STATUS_LABEL: Record<string, string> = { planned: "Prévue", in_progress: "En cours", done: "Terminée" };

interface HistoryRow {
  id: string;
  tour_number: string;
  start_at: string;
  end_at: string | null;
  status: string;
  start_km: number | null;
  end_km: number | null;
  services: { name: string } | null;
  vehicles: { registration: string } | null;
  users: { full_name: string } | null;
}

/**
 * "Historique de tournées visible par rôle" — past tours (in_progress
 * or done; "planned" stays on the /planning tab, that's the future).
 * A chauffeur only ever sees their own (driver_id forced server-side,
 * never trusted from a query param); exploitation (manager/
 * manager_chauffeur) is scoped to their own service(s), same
 * convention as /planning; direction sees the whole organisation and
 * additionally gets a service filter.
 */
export default async function TourHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; service?: string; driver?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");
  if (!planningEnabled) {
    return (
      <EmptyState
        title="Module Planning non activé"
        description="L'historique des tournées dépend du module Planning — activez-le depuis les paramètres de votre organisation."
      />
    );
  }

  const isDirection = appUser.role === "direction";
  const isChauffeur = appUser.role === "chauffeur";

  const from = params.from && !Number.isNaN(Date.parse(params.from)) ? params.from : addDays(todayISO(), -30);
  const to = params.to && !Number.isNaN(Date.parse(params.to)) ? params.to : todayISO();
  const toExclusive = addDays(to, 1);

  const [{ data: allServices }, { data: myServiceRows }, { data: drivers }] = await Promise.all([
    isDirection ? supabase.from("services").select("id, name").order("name") : Promise.resolve({ data: null }),
    isDirection || isChauffeur
      ? Promise.resolve({ data: null })
      : supabase.from("user_services").select("services(id, name)").eq("user_id", appUser.id),
    isChauffeur
      ? Promise.resolve({ data: null })
      : supabase.from("users").select("id, full_name").eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
  ]);

  const services = isDirection ? (allServices ?? []) : ((myServiceRows ?? []) as any[]).map((r) => r.services).filter(Boolean);
  const myServiceIds = services.map((s: any) => s.id);

  let query = supabase
    .from("planning_entries")
    .select(
      "id, tour_number, start_at, end_at, status, start_km, end_km, services(name), vehicles(registration), users!planning_entries_driver_id_fkey(full_name)",
    )
    .in("status", ["in_progress", "done"])
    .gte("start_at", `${from}T00:00:00`)
    .lt("start_at", `${toExclusive}T00:00:00`)
    .order("start_at", { ascending: false })
    .limit(300);

  if (isChauffeur) {
    // Never trusts a query param for this — a driver's own id only.
    query = query.eq("driver_id", appUser.id);
  } else {
    if (!isDirection) query = query.in("service_id", myServiceIds.length > 0 ? myServiceIds : ["00000000-0000-0000-0000-000000000000"]);
    if (params.service) query = query.eq("service_id", params.service);
    if (params.driver) query = query.eq("driver_id", params.driver);
  }

  const { data: rows } = await query;
  const history = (rows ?? []) as unknown as HistoryRow[];

  return (
    <div>
      <PageHeader
        title="Historique des tournées"
        description={
          isChauffeur
            ? "Vos tournées passées."
            : "Tournées passées de votre périmètre — démarrées ou terminées."
        }
      />

      {!isChauffeur && (
        <TourHistoryFilters
          from={from}
          to={to}
          services={isDirection ? services : []}
          drivers={drivers ?? []}
          selectedService={params.service ?? ""}
          selectedDriver={params.driver ?? ""}
        />
      )}

      {history.length === 0 ? (
        <EmptyState title="Aucune tournée sur cette période" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-navy/40">
              <tr>
                <th className="pb-2">Date</th>
                {!isChauffeur && <th className="pb-2">Chauffeur</th>}
                <th className="pb-2">Service</th>
                <th className="pb-2">Véhicule</th>
                <th className="pb-2">Tournée</th>
                <th className="pb-2">Km</th>
                <th className="pb-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-navy/5">
                  <td className="py-2">
                    {new Date(r.start_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  {!isChauffeur && <td className="py-2">{r.users?.full_name ?? "—"}</td>}
                  <td className="py-2">{r.services?.name ?? "—"}</td>
                  <td className="py-2">{r.vehicles?.registration ?? "—"}</td>
                  <td className="py-2">n°{r.tour_number}</td>
                  <td className="py-2">
                    {r.start_km !== null ? `${r.start_km}${r.end_km !== null ? ` → ${r.end_km}` : ""} km` : "—"}
                  </td>
                  <td className="py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
