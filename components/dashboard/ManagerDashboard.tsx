import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { AlertList } from "@/components/alerts/AlertList";
import { TourHeroCard } from "@/components/dashboard/TourHeroCard";
import { AssistedClock } from "@/components/time-clock/AssistedClock";
import { getFleetConsumptionRanking } from "@/lib/vehicles/consumption";
import { chargerEcartsATraiter } from "@/lib/fuel/ecarts-serveur";
import type { AppUser } from "@/lib/auth/session";
import { voitToutLOrganisation } from "@/lib/roles/perimetre";
import { chargerAlertes } from "@/lib/alerts/charger";
import { ecranOuvrable, ecranTourneesEnCours, SUITE_ECARTS_A_TRAITER, tuilesOuvrables } from "@/lib/acces/tuiles-accueil";

/**
 * A manager runs one or more services day-to-day: fuel gaps to handle
 * first (GODAC's main axis), who's on the road right now, what's waiting
 * for a decision (tickets to check, leave requests, new drivers), and
 * which vehicles are drinking too much fuel. A manager who also drives (users.can_drive) additionally runs their own tours, so
 * they also get the same start/end-tour action a plain chauffeur has.
 *
 * Also the dashboard of the « exploitation » role: same tiles, over the
 * whole organisation instead of the manager's services.
 */
export async function ManagerDashboard({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const supabase = await createServerSupabaseClient();
  const isManagerChauffeur = appUser.conduit;
  const leaveEnabled = enabledModules.includes("leave_management");
  const maintenanceEnabled = enabledModules.includes("maintenance_requests");
  const ctx = { role: appUser.role, modules: new Set(enabledModules), conduit: appUser.conduit };
  // Carte « Démarrer / Terminer ma tournée » : seulement si l'écran s'ouvre (module Planning).
  const tourneeOuvrable = isManagerChauffeur && ecranOuvrable("moi.tournee_depart", ctx);

  const { data: myServices } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
  const myServiceIds = (myServices ?? []).map((s) => s.service_id);
  const serviceFilter = myServiceIds.length > 0 ? myServiceIds : ["00000000-0000-0000-0000-000000000000"];
  // Exploitation : toute l'organisation, aucun filtre par service.
  const toutLOrganisation = voitToutLOrganisation(appUser.role);

  const [
    openTourRes,
    ongoingToursRes,
    fleetVehiclesRes,
    pendingOcrRes,
    pendingLeaveRes,
    pendingSignupsRes,
    openMaintenanceRes,
    openAlertsRes,
    ecartsRes,
  ] = await Promise.all([
    isManagerChauffeur
      ? supabase
          .from("planning_entries")
          .select("id, tour_number, start_at, vehicles(registration)")
          .eq("driver_id", appUser.id)
          .eq("status", "in_progress")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    (() => {
      const q = supabase
        .from("planning_entries")
        .select("id, tour_number, start_at, vehicles(registration), users!planning_entries_driver_id_fkey(full_name)")
        .eq("status", "in_progress");
      return (toutLOrganisation ? q : q.in("service_id", serviceFilter)).order("start_at", { ascending: true });
    })(),
    (() => {
      const q = supabase.from("vehicles").select("id, registration").eq("status", "active");
      return toutLOrganisation ? q : q.in("service_id", serviceFilter);
    })(),
    supabase.from("fuel_entries").select("id", { count: "exact", head: true }).in("status", ["pending_ocr", "awaiting_validation"]),
    leaveEnabled
      ? (() => {
          const q = supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
          return toutLOrganisation ? q : q.in("service_id", serviceFilter);
        })()
      : Promise.resolve({ count: null }),
    supabase.from("users").select("id, user_services(service_id)").eq("organization_id", appUser.organization_id).eq("pending_approval", true),
    maintenanceEnabled
      ? supabase.from("vehicle_interventions").select("id", { count: "exact", head: true }).not("status", "in", "(done,cancelled)")
      : Promise.resolve({ count: null }),
    // Diffusées et personnelles, jamais le rappel personnel d'un chauffeur.
    chargerAlertes(supabase, appUser.id, { ouvertes: true, limite: 5 }),
    // Écarts carburant à traiter, compteur global (RLS : son service, ou toute
    // l'organisation pour l'exploitation).
    chargerEcartsATraiter(supabase),
  ]);

  const openTour = openTourRes.data as { id: string; tour_number: string; start_at: string; vehicles: { registration: string } | null } | null;
  const ongoingTours = (ongoingToursRes.data ?? []) as any as {
    id: string;
    tour_number: string;
    start_at: string;
    vehicles: { registration: string } | null;
    users: { full_name: string } | null;
  }[];
  const openAlerts = openAlertsRes;

  const pendingSignups = ((pendingSignupsRes.data ?? []) as any[]).filter((u) => {
    const services = (u.user_services ?? []).map((s: any) => s.service_id);
    return toutLOrganisation || services.length === 0 || services.some((id: string) => myServiceIds.includes(id));
  });

  // Toute la flotte en trois requêtes (plus une série par véhicule).
  const consumptionRanking = await getFleetConsumptionRanking(supabase, (fleetVehiclesRes.data ?? []) as { id: string; registration: string }[], 30);

  // Seulement les tuiles dont l'écran s'ouvre (rôle, conduite, modules).
  const ecranTournees = ecranTourneesEnCours(ctx);
  const tiles = tuilesOuvrables(
    [
      // L'axe principal de GODAC en tête : les écarts carburant.
      { libelle: "Écarts carburant à traiter", valeur: String(ecartsRes.ids.length), accent: ecartsRes.ids.length ? "orange" : "teal", ecran: "carburant.pleins", suite: SUITE_ECARTS_A_TRAITER },
      ecranTournees && { libelle: "Tournées en cours", valeur: String(ongoingTours.length), accent: "teal", ecran: ecranTournees },
      { libelle: "Tickets à vérifier", valeur: String(pendingOcrRes.count ?? 0), accent: "gold", ecran: "carburant.revue_ocr" },
      { libelle: "Nouveaux chauffeurs à valider", valeur: String(pendingSignups.length), accent: "teal", ecran: "equipe.inscriptions" },
      leaveEnabled && { libelle: "Congés à valider", valeur: String(pendingLeaveRes.count ?? 0), accent: "gold", ecran: "equipe.conges" },
      maintenanceEnabled && { libelle: "Demandes d'entretien ouvertes", valeur: String(openMaintenanceRes.count ?? 0), accent: "orange", ecran: "flotte.entretien" },
    ],
    ctx,
  );

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
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description={toutLOrganisation ? "Vue d'ensemble de toute l'entreprise." : "Vue d'ensemble de votre équipe."} />
      {autoClockEnabled && <AssistedClock hasOpenTour={Boolean(openTour)} />}

      {isManagerChauffeur && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tourneeOuvrable && <TourHeroCard openTour={openTour} />}
          <QrCodeBadge type="driver" id={appUser.id} title={appUser.full_name} subtitle="Mon badge chauffeur — à présenter à la pompe" />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.libelle} href={t.href} className="block">
            <StatTile label={t.libelle} value={t.valeur} accent={t.accent} />
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
          <AlertList alerts={openAlerts} viewerRole={appUser.role} conduit={appUser.conduit} modules={enabledModules} />
        </div>
      )}
    </div>
  );
}
