import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { AlertList } from "@/components/alerts/AlertList";
import { TourHeroCard } from "@/components/dashboard/TourHeroCard";
import { AssistedClock } from "@/components/time-clock/AssistedClock";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";
import type { AppUser } from "@/lib/auth/session";

/**
 * A manager runs one or more services day-to-day: who's on the road
 * right now, what's waiting for a decision (OCR tickets, leave
 * requests, new drivers), and which vehicles are drinking too much
 * fuel. A manager_chauffeur additionally drives their own tours, so
 * they also get the same start/end-tour action a plain chauffeur has.
 */
export async function ManagerDashboard({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const supabase = await createServerSupabaseClient();
  const isManagerChauffeur = appUser.role === "manager_chauffeur";
  const leaveEnabled = enabledModules.includes("leave_management");
  const maintenanceEnabled = enabledModules.includes("maintenance_requests");

  const { data: myServices } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
  const myServiceIds = (myServices ?? []).map((s) => s.service_id);
  const serviceFilter = myServiceIds.length > 0 ? myServiceIds : ["00000000-0000-0000-0000-000000000000"];

  const [
    openTourRes,
    ongoingToursRes,
    fleetVehiclesRes,
    pendingOcrRes,
    pendingLeaveRes,
    pendingSignupsRes,
    openMaintenanceRes,
    openAlertsRes,
  ] = await Promise.all([
    isManagerChauffeur
      ? supabase
          .from("planning_entries")
          .select("id, tour_number, start_at, vehicles(registration)")
          .eq("driver_id", appUser.id)
          .eq("status", "in_progress")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("planning_entries")
      .select("id, tour_number, start_at, vehicles(registration), users!planning_entries_driver_id_fkey(full_name)")
      .eq("status", "in_progress")
      .in("service_id", serviceFilter)
      .order("start_at", { ascending: true }),
    supabase.from("vehicles").select("id, registration").eq("status", "active").in("service_id", serviceFilter),
    supabase.from("fuel_entries").select("id", { count: "exact", head: true }).in("status", ["pending_ocr", "awaiting_validation"]),
    leaveEnabled
      ? supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending").in("service_id", serviceFilter)
      : Promise.resolve({ count: null }),
    supabase.from("users").select("id, user_services(service_id)").eq("organization_id", appUser.organization_id).eq("pending_approval", true),
    maintenanceEnabled
      ? supabase.from("vehicle_interventions").select("id", { count: "exact", head: true }).not("status", "in", "(done,cancelled)")
      : Promise.resolve({ count: null }),
    supabase
      .from("alerts")
      .select("id, type, severity, message, status, notified_at, created_at, related_table, related_id")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const openTour = openTourRes.data as { id: string; tour_number: string; start_at: string; vehicles: { registration: string } | null } | null;
  const ongoingTours = (ongoingToursRes.data ?? []) as any as {
    id: string;
    tour_number: string;
    start_at: string;
    vehicles: { registration: string } | null;
    users: { full_name: string } | null;
  }[];
  const openAlerts = (openAlertsRes.data ?? []) as any[];

  const pendingSignups = ((pendingSignupsRes.data ?? []) as any[]).filter((u) => {
    const services = (u.user_services ?? []).map((s: any) => s.service_id);
    return services.length === 0 || services.some((id: string) => myServiceIds.includes(id));
  });

  const consumptionRanking = (
    await Promise.all(
      ((fleetVehiclesRes.data ?? []) as { id: string; registration: string }[]).map(async (v) => ({
        registration: v.registration,
        consumption: await getVehicleConsumption(supabase, v.id, 30),
      })),
    )
  )
    .filter((v): v is { registration: string; consumption: number } => v.consumption !== null)
    .sort((a, b) => b.consumption - a.consumption)
    .slice(0, 5);

  const tiles: { label: string; value: number; accent: "teal" | "orange" | "gold"; href: string }[] = [
    { label: "Tournées en cours", value: ongoingTours.length, accent: "teal", href: "/tours/history" },
    { label: "Tickets OCR en attente", value: pendingOcrRes.count ?? 0, accent: "gold", href: "/carburant/revue-ocr" },
    { label: "Nouveaux chauffeurs à valider", value: pendingSignups.length, accent: "teal", href: "/driver-signups" },
  ];
  if (leaveEnabled) tiles.push({ label: "Congés à valider", value: pendingLeaveRes.count ?? 0, accent: "gold", href: "/leaves" });
  if (maintenanceEnabled) tiles.push({ label: "Demandes d'entretien ouvertes", value: openMaintenanceRes.count ?? 0, accent: "orange", href: "/flotte/entretien" });

  // Pointage assisté only concerns someone who also drives.
  const autoClockEnabled =
    isManagerChauffeur && enabledModules.includes("time_clock")
      ? Boolean(
          (await supabase.from("organizations").select("auto_clock_enabled").eq("id", appUser.organization_id).single()).data
            ?.auto_clock_enabled,
        )
      : false;

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Vue d'ensemble de votre équipe." />
      {autoClockEnabled && <AssistedClock hasOpenTour={Boolean(openTour)} />}

      {isManagerChauffeur && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TourHeroCard openTour={openTour} />
          <QrCodeBadge type="driver" id={appUser.id} title={appUser.full_name} subtitle="Mon badge chauffeur — à présenter à la pompe" />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="block">
            <StatTile label={t.label} value={String(t.value)} accent={t.accent} />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-lg">Tournées en cours</h2>
          {ongoingTours.length === 0 ? (
            <p className="text-sm text-navy/60">Aucune tournée en cours actuellement.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {ongoingTours.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
                  <span>
                    {t.users?.full_name ?? "—"} · {t.vehicles?.registration ?? "—"} · n°{t.tour_number}
                  </span>
                  <span className="text-xs text-navy/60">
                    depuis {new Date(t.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg">Consommation (30 jours)</h2>
          {consumptionRanking.length === 0 ? (
            <p className="text-sm text-navy/60">Pas assez de données pour établir un classement.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {consumptionRanking.map((v) => (
                <li key={v.registration} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
                  <span>{v.registration}</span>
                  <span className="font-medium">{v.consumption} L/100km</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {openAlerts.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-lg">Notifications</h2>
          <AlertList alerts={openAlerts} viewerRole={appUser.role} />
        </div>
      )}
    </div>
  );
}
