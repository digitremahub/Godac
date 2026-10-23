import Link from "next/link";
import { Suspense } from "react";
import { ATraiterAttente, ATraiterBloc } from "@/components/dashboard/ATraiterBloc";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card } from "@/components/ui";
import { AlertList } from "@/components/alerts/AlertList";
import { BarChartCard, type BarDatum } from "@/components/reporting/BarChartCard";
import { getFleetConsumptionRanking } from "@/lib/vehicles/consumption";
import { addDays } from "@/lib/planning/dates";
import { summarizeFuelRows, TRUSTED_FUEL_STATUSES, type FuelTotalsRow } from "@/lib/fuel/totals";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { parisDay, parisMidnightIso, parisMonthStartIso } from "@/lib/utils/paris-time";
import type { AppUser } from "@/lib/auth/session";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";
import { chargerAlertes } from "@/lib/alerts/charger";
import { filtreDestinataire } from "@/lib/alerts/lecture";
import { ecranTourneesEnCours, SUITE_ECARTS_A_TRAITER, tuilesOuvrables } from "@/lib/acces/tuiles-accueil";
import { chargerEcartsATraiter } from "@/lib/fuel/ecarts-serveur";
import { bulletinsAValider, suiteMoisPaie } from "@/lib/paie/accueil";
import { currentMonth } from "@/lib/planning/dates";
import { urlDe } from "@/lib/acces/catalogue";

/**
 * Accueil de la direction, toute l'organisation, dans l'ordre :
 * 1. ce qui attend une décision (écarts carburant d'abord, bulletins à
 *    valider, inscriptions, congés, entretien) ;
 * 2. les indicateurs, coût carburant du mois en premier ;
 * 3. les tournées colis en cours, le reporting, la consommation et les
 *    notifications.
 * Les codes de secours des chauffeurs sont dans Équipe › Utilisateurs.
 */
export async function DirectionDashboard({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const supabase = await createServerSupabaseClient();
  const biEnabled = enabledModules.includes("bi_reporting");
  const leaveEnabled = enabledModules.includes("leave_management");
  const maintenanceEnabled = enabledModules.includes("maintenance_requests");
  const payslipsEnabled = enabledModules.includes("payslips");
  const ctx = { role: appUser.role, modules: new Set(enabledModules) };

  // Bornes en heure de Paris (pas minuit UTC ni l'heure du serveur).
  const monthStartISO = parisMonthStartIso();
  const since30d = parisMidnightIso(addDays(parisDay(), -30));

  const [
    activeVehiclesRes,
    activeDriversRes,
    ongoingRunsRes,
    openAlertsCountRes,
    openAlertsRes,
    pendingSignupsRes,
    pendingLeaveRes,
    openMaintenanceRes,
    pendingPayslipsRes,
    monthFuelRes,
    ecartsRes,
    fuelRowsRes,
    tourRowsRes,
  ] = await Promise.all([
    supabase.from("vehicles").select("id, registration").eq("status", "active"),
    supabase.from("users").select("id", { count: "exact", head: true }).or(FILTRE_CONDUCTEURS).eq("active", true),
    supabase
      .from("delivery_runs")
      .select("id, name, run_date, started_at, driver_id, service_id, vehicle_id")
      .eq("organization_id", appUser.organization_id)
      // Une fiche peut déjà être visible dans le suivi en direct pendant
      // le chargement, avant que le chauffeur ne démarre officiellement.
      .in("status", ["loading", "in_progress"])
      .order("started_at", { ascending: false }),
    // Alertes de la direction (diffusées ou personnelles), jamais le rappel personnel d'un chauffeur.
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open").or(filtreDestinataire(appUser.id)),
    chargerAlertes(supabase, appUser.id, { ouvertes: true, limite: 5 }),
    supabase.from("users").select("id", { count: "exact", head: true }).eq("organization_id", appUser.organization_id).eq("pending_approval", true),
    leaveEnabled
      ? supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: null }),
    maintenanceEnabled
      ? supabase.from("vehicle_interventions").select("id", { count: "exact", head: true }).not("status", "in", "(done,cancelled)")
      : Promise.resolve({ count: null }),
    // Bulletins en attente de la direction, tous mois confondus.
    payslipsEnabled
      ? supabase.from("payslips").select("period_start, validation_status").eq("validation_status", "en_attente")
      : Promise.resolve({ data: null }),
    // Coût carburant du mois (pleins de confiance, toutes les lignes).
    fetchAllRows<FuelTotalsRow>((a, b) =>
      supabase.from("fuel_entries").select("liters, total_amount, status, product").in("status", [...TRUSTED_FUEL_STATUSES]).gte("occurred_at", monthStartISO).order("id").range(a, b),
    ),
    // Écarts carburant à traiter (compteur global, axe principal de GODAC).
    chargerEcartsATraiter(supabase),
    // Pleins de confiance uniquement, toutes les lignes (pas de .limit()
    // qui tronquait les totaux en silence).
    biEnabled
      ? fetchAllRows((a, b) =>
          supabase
            .from("fuel_entries")
            .select("liters, total_amount, status, product, vehicles(registration)")
            .in("status", [...TRUSTED_FUEL_STATUSES])
            .gte("occurred_at", since30d)
            .order("id")
            .range(a, b),
        )
      : Promise.resolve(null),
    biEnabled
      ? fetchAllRows((a, b) =>
          supabase
            .from("planning_entries")
            .select("status, services(name)")
            .in("status", ["in_progress", "done"])
            .gte("start_at", since30d)
            .order("id")
            .range(a, b),
        )
      : Promise.resolve(null),
  ]);

  const openAlerts = openAlertsRes;
  const ongoingRuns = (ongoingRunsRes.data ?? []) as {
    id: string; name: string | null; run_date: string; started_at: string | null;
    driver_id: string | null; service_id: string | null; vehicle_id: string | null;
  }[];
  const activeRunDriverIds = [...new Set(ongoingRuns.map((r) => r.driver_id).filter((id): id is string => Boolean(id)))];
  const activeRunServiceIds = [...new Set(ongoingRuns.map((r) => r.service_id).filter((id): id is string => Boolean(id)))];
  const activeRunVehicleIds = [...new Set(ongoingRuns.map((r) => r.vehicle_id).filter((id): id is string => Boolean(id)))];
  const [{ data: activeRunDrivers }, { data: activeRunServices }, { data: activeRunVehicles }] = await Promise.all([
    activeRunDriverIds.length ? supabase.from("users").select("id, full_name").in("id", activeRunDriverIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    activeRunServiceIds.length ? supabase.from("services").select("id, name").in("id", activeRunServiceIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    activeRunVehicleIds.length ? supabase.from("vehicles").select("id, registration").in("id", activeRunVehicleIds) : Promise.resolve({ data: [] as { id: string; registration: string }[] }),
  ]);
  const driverNameById = new Map((activeRunDrivers ?? []).map((r) => [r.id, r.full_name]));
  const serviceNameById = new Map((activeRunServices ?? []).map((r) => [r.id, r.name]));
  const vehicleById = new Map((activeRunVehicles ?? []).map((r) => [r.id, r.registration]));
  // Une seule série de requêtes pour toute la flotte (plus une par véhicule).
  const consumptionRanking = await getFleetConsumptionRanking(supabase, (activeVehiclesRes.data ?? []) as { id: string; registration: string }[], 30);
  const fuelTotals = summarizeFuelRows(monthFuelRes.rows);
  const aValider = bulletinsAValider((pendingPayslipsRes.data ?? []) as { period_start: string; validation_status: string | null }[]);

  let fuelCostByVehicle: BarDatum[] = [];
  let toursByService: BarDatum[] = [];
  if (biEnabled) {
    const costByVehicle = new Map<string, number>();
    for (const r of (fuelRowsRes?.rows ?? []) as any[]) {
      const name = r.vehicles?.registration ?? "—";
      costByVehicle.set(name, (costByVehicle.get(name) ?? 0) + Number(r.total_amount ?? 0));
    }
    fuelCostByVehicle = Array.from(costByVehicle, ([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const toursByServiceMap = new Map<string, number>();
    for (const r of (tourRowsRes?.rows ?? []) as any[]) {
      const name = r.services?.name ?? "—";
      toursByServiceMap.set(name, (toursByServiceMap.get(name) ?? 0) + 1);
    }
    toursByService = Array.from(toursByServiceMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }

  const ecranTournees = ecranTourneesEnCours(ctx);
  const pendingTiles = tuilesOuvrables(
    [
      { libelle: "Écarts carburant à traiter", valeur: String(ecartsRes.ids.length), accent: ecartsRes.ids.length ? "orange" : "teal", ecran: "carburant.pleins", suite: SUITE_ECARTS_A_TRAITER },
      payslipsEnabled && { libelle: "Bulletins à valider", valeur: String(aValider.nombre), accent: aValider.nombre ? "orange" : "teal", ecran: "equipe.paie", suite: suiteMoisPaie(aValider.mois, currentMonth()) },
      { libelle: "Nouveaux chauffeurs à valider", valeur: String(pendingSignupsRes.count ?? 0), accent: "teal", ecran: "equipe.inscriptions" },
      leaveEnabled && { libelle: "Congés à valider", valeur: String(pendingLeaveRes.count ?? 0), accent: "gold", ecran: "equipe.conges" },
      maintenanceEnabled && { libelle: "Demandes d'entretien ouvertes", valeur: String(openMaintenanceRes.count ?? 0), accent: "orange", ecran: "flotte.entretien" },
    ],
    ctx,
  );

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Vue d'ensemble de l'organisation." />

      {/* Une seule liste de tout ce qui attend une décision, triée par urgence (page dédiée : actions groupées). */}
      <Suspense fallback={<ATraiterAttente />}>
        <ATraiterBloc appUser={appUser} enabledModules={enabledModules} ecartsIds={ecartsRes.ids} />
      </Suspense>

      {/* À traiter d'abord : écarts carburant, bulletins à valider… */}
      <h2 className="mb-3 text-lg">À traiter</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {pendingTiles.map((t) => (
          <Link key={t.libelle} href={t.href} className="block">
            <StatTile label={t.libelle} value={t.valeur} accent={t.accent} />
          </Link>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label={`Carburant ce mois${monthFuelRes.truncated ? " (tronqué)" : ""}`} value={`${Math.round(fuelTotals.cost).toLocaleString("fr-FR")} €`} accent="gold" />
        <StatTile label="Véhicules actifs" value={String((activeVehiclesRes.data ?? []).length)} />
        <StatTile label="Chauffeurs actifs" value={String(activeDriversRes.count ?? 0)} accent="gold" />
        {tuilesOuvrables(
          [
            ecranTournees && { libelle: "Tournées colis en cours", valeur: String(ongoingRuns.length), accent: "teal", ecran: ecranTournees },
            { libelle: "Notifications à traiter", valeur: String(openAlertsCountRes.count ?? 0), accent: openAlertsCountRes.count ? "orange" : "teal", ecran: "communication.alertes" },
          ],
          ctx,
        ).map((t) => (
          <Link key={t.libelle} href={t.href} className="block">
            <StatTile label={t.libelle} value={t.valeur} accent={t.accent} />
          </Link>
        ))}
      </div>

      <Card className="mb-6">
        {ongoingRunsRes.error && (
          <p role="alert" className="mb-3 rounded-lg border border-orange/40 bg-orange/10 p-3 text-sm text-orange-ink">
            Le suivi des tournées est momentanément indisponible. Réessayez dans quelques minutes ou contactez le support.
          </p>
        )}
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg">Tournées colis en cours</h2>
            <p className="text-sm text-navy/60">Tournées colis démarrées ou en chargement.</p>
          </div>
          {ecranTournees && (
            <Link href={urlDe(ecranTournees)} className="text-sm text-teal-ink hover:underline">
              {ecranTournees === "exploitation.suivi" ? "Suivi en direct →" : "Voir le détail →"}
            </Link>
          )}
        </div>
        {ongoingRuns.length === 0 ? (
          <p className="text-sm text-navy/60">Aucune tournée colis en cours pour le moment.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ongoingRuns.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 rounded-xl border border-navy/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{r.name ?? "Tournée du jour"}</p>
                  <p className="text-sm text-navy/65">{driverNameById.get(r.driver_id ?? "") ?? "Chauffeur non renseigné"} · {serviceNameById.get(r.service_id ?? "") ?? "Service non renseigné"}</p>
                </div>
                <div className="text-sm text-navy/65 sm:text-right">
                  <p>{vehicleById.get(r.vehicle_id ?? "") ?? "Véhicule non renseigné"}</p>
                  <p>{r.started_at ? new Date(r.started_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "Heure de départ inconnue"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>


      {biEnabled && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg">Reporting (30 jours)</h2>
            <Link href="/dashboard/reporting" className="text-sm text-teal-ink hover:underline">
              Voir le reporting complet →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarChartCard title="Coût carburant par véhicule (top 8)" data={fuelCostByVehicle} valueSuffix=" €" />
            <BarChartCard title="Tournées par service" data={toursByService} />
          </div>
          {(fuelRowsRes?.truncated || tourRowsRes?.truncated) && (
            <p className="mt-2 text-xs text-orange-ink">Résultats tronqués : trop de lignes sur la période, les totaux sont incomplets.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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

        <div>
          <h2 className="mb-3 text-lg">Notifications</h2>
          <AlertList alerts={openAlerts} viewerRole={appUser.role} conduit={appUser.conduit} modules={enabledModules} />
        </div>
      </div>
    </div>
  );
}
