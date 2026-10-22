import { EtatAcces } from "@/components/acces/EtatAcces";
import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { PayrollTable } from "@/components/payroll/PayrollTable";
import { PayrollFilters } from "@/components/payroll/PayrollFilters";
import { firstOfMonth, addMonths, addDays, currentMonth, parisCalendarDate } from "@/lib/planning/dates";
import { computeHourlyRates } from "@/lib/business/payroll";
import { classifyLocation } from "@/lib/time-clock/classify-location";
import { buildDriverDepotsMap } from "@/lib/time-clock/driver-depots";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";
import { lireArrets } from "@/lib/arrets/serveur";
import { estEnArret, heuresPrevuesDuMois } from "@/lib/arrets/declaration";

interface BadgeEntry {
  user_id: string;
  clocked_in_at: string;
  clocked_out_at: string;
  clock_in_lat: number | string | null;
  clock_in_lng: number | string | null;
}

interface DoneTour {
  driver_id: string | null;
}

interface PlanningSpan {
  driver_id: string | null;
  start_at: string;
  end_at: string | null;
}

/**
 * Direction-only. Heures travaillées, par jour (calendrier Paris) et
 * par chauffeur :
 *
 *  - si le badge d'entrée ce jour-là est géolocalisé au dépôt
 *    (organizations.depot_lat/lng, même tolérance 300 m que
 *    lib/time-clock/classify-location.ts) ET qu'une tournée est
 *    planifiée ce jour-là pour ce chauffeur : l'heure de DÉBUT vient du
 *    planning (start_at le plus tôt ce jour-là), l'heure de FIN reste
 *    le dernier badge de sortie du jour — le badge d'arrivée au dépôt
 *    confirme que le chauffeur a bien commencé "à l'heure du planning",
 *    sans que le badge lui-même serve de point de départ (trajet
 *    domicile-dépôt non rémunéré différemment selon qu'on badge pile à
 *    l'heure ou un peu avant/après).
 *  - sinon (pas de géoloc, position hors dépôt, ou pas de tournée
 *    planifiée ce jour), mais avec au moins un badge ce jour-là :
 *    badge d'entrée → badge de sortie, comme avant.
 *  - aucun badge DU TOUT ce jour-là, mais une tournée terminée existe
 *    (end_at renseigné) : repli sur l'horaire réel de la tournée
 *    (start_at → end_at) — moins fiable qu'un badge (ne couvre pas les
 *    tâches avant/après tournée), mais toujours préférable à 0h pour
 *    une journée par ailleurs documentée comme travaillée (la
 *    pointeuse n'ayant simplement pas été utilisée ce jour-là).
 *
 * Ce n'est qu'une étape intermédiaire : à terme (une fois la
 * géolocalisation fiable des deux côtés), le badge seul définira toute
 * la plage horaire, planning ou pas.
 *
 * Le nombre de tournées reste une stat à part, issue uniquement des
 * tournées "done" du planning — informative, jamais utilisée dans le
 * calcul des heures/salaire.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; driver?: string }>;
}) {
  const params = await searchParams;
  const g = await garderPage("equipe.heures");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;

  const supabase = await createServerSupabaseClient();
  const timeClockEnabled = await isModuleEnabled(supabase, appUser.organization_id, "time_clock");
  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");
  if (!timeClockEnabled) {
    const paie = await isModuleEnabled(supabase, appUser.organization_id, "payslips");
    return (
      <div>
        <PageHeader title={paie ? "Paie & salaires" : "Salaires"} />
        <EtatAcces motif="module" ecran="Heures & salaires" modules={["time_clock"]} direction={appUser.role === "direction"} />
      </div>
    );
  }

  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const monthStart = firstOfMonth(month);
  const monthEnd = firstOfMonth(addMonths(month, 1));
  // Last calendar day of `month` — matches exactly what
  // GeneratePayslipForm/payroll's own "générer" button already sends
  // as period_end (firstAndLastOfMonth), so a payslip row for this
  // month is found by period_start/period_end alone, not a range scan.
  const periodEnd = addDays(monthEnd, -1);
  const selectedDriver = params.driver ?? "";
  const payslipsEnabled = await isModuleEnabled(supabase, appUser.organization_id, "payslips");

  const [{ data: drivers }, { data: contracts }, { data: badgeData }, { data: toursData }, { data: planningSpans }, { data: existingPayslips }, { depotsFor }] =
    await Promise.all([
      supabase.from("users").select("id, full_name").eq("active", true).or(FILTRE_CONDUCTEURS).order("full_name"),
      // Separate table (not a column on `users`, whose RLS lets any org
      // member read any row) — see 20260101000077.
      supabase.from("user_contracts").select("user_id, monthly_gross_salary, monthly_net_salary, contractual_monthly_hours"),
      (() => {
        let query = supabase
          .from("time_clock_entries")
          .select("user_id, clocked_in_at, clocked_out_at, clock_in_lat, clock_in_lng")
          .not("clocked_out_at", "is", null)
          .gte("clocked_in_at", `${monthStart}T00:00:00`)
          .lt("clocked_in_at", `${monthEnd}T00:00:00`);
        if (selectedDriver) query = query.eq("user_id", selectedDriver);
        return query;
      })(),
      planningEnabled
        ? (() => {
            let query = supabase
              .from("planning_entries")
              .select("driver_id")
              .eq("status", "done")
              .not("driver_id", "is", null)
              .gte("start_at", `${monthStart}T00:00:00`)
              .lt("start_at", `${monthEnd}T00:00:00`);
            if (selectedDriver) query = query.eq("driver_id", selectedDriver);
            return query;
          })()
        : Promise.resolve({ data: null }),
      // Toute tournée planifiée ce mois-ci, quel que soit son statut —
      // contrairement à toursData ci-dessus (stat "tournées" affichée
      // telle quelle, uniquement les "done"), on a besoin ici de
      // l'heure de départ PRÉVUE (dès la planification) et de l'heure
      // de fin réelle quand la tournée est terminée (end_at), pour le
      // repli "aucun badge ce jour-là" ci-dessous.
      planningEnabled
        ? (() => {
            let query = supabase
              .from("planning_entries")
              .select("driver_id, start_at, end_at")
              .not("driver_id", "is", null)
              .gte("start_at", `${monthStart}T00:00:00`)
              .lt("start_at", `${monthEnd}T00:00:00`);
            if (selectedDriver) query = query.eq("driver_id", selectedDriver);
            return query;
          })()
        : Promise.resolve({ data: null }),
      payslipsEnabled
        ? supabase.from("payslips").select("user_id").eq("period_start", monthStart).eq("period_end", periodEnd)
        : Promise.resolve({ data: null }),
      buildDriverDepotsMap(supabase, appUser.organization_id),
    ]);

  const generatedDriverIds = (existingPayslips ?? []).map((p) => p.user_id);

  // Arrêts de travail non refusés du mois : heures prévues diminuées, pas
  // d'heures reprises du planning ces jours-là (table absente : aucun).
  const { lignes: arretsMois } = await lireArrets(supabase, { du: monthStart, au: periodEnd, ...(selectedDriver ? { userId: selectedDriver } : {}) });
  const arretsParSalarie = new Map<string, { du: string; au: string; statut: string }[]>();
  for (const a of arretsMois) arretsParSalarie.set(a.userId, [...(arretsParSalarie.get(a.userId) ?? []), { du: a.du, au: a.au, statut: a.statut }]);

  // Le plus tôt start_at planifié ce jour-là, par chauffeur — clé
  // "driverId|YYYY-MM-DD" (calendrier Paris, voir parisCalendarDate).
  const plannedStartByDriverDay = new Map<string, string>();
  // Tournées terminées (end_at renseigné) ce jour-là, par chauffeur —
  // repli utilisé uniquement quand ce jour n'a absolument aucun badge
  // (voir plus bas) : un jour avec une tournée "done" mais aucun badge
  // enregistré ne doit pas disparaître purement et simplement du
  // calcul des heures — ça revient sinon à ne pas payer une journée
  // réellement travaillée simplement parce que la pointeuse n'a pas
  // été utilisée. Moins fiable qu'un badge (ne couvre que la tournée
  // elle-même, pas les tâches avant/après), mais toujours mieux que 0h
  // pour un jour par ailleurs documenté comme travaillé.
  const planningSpansByDriverDay = new Map<string, { start_at: string; end_at: string }[]>();
  for (const p of (planningSpans ?? []) as PlanningSpan[]) {
    if (!p.driver_id) continue;
    const key = `${p.driver_id}|${parisCalendarDate(p.start_at)}`;
    const existing = plannedStartByDriverDay.get(key);
    if (!existing || p.start_at < existing) plannedStartByDriverDay.set(key, p.start_at);
    if (p.end_at) {
      const spans = planningSpansByDriverDay.get(key) ?? [];
      spans.push({ start_at: p.start_at, end_at: p.end_at });
      planningSpansByDriverDay.set(key, spans);
    }
  }

  // Sessions de badge regroupées par chauffeur + jour, avec un
  // indicateur "au moins un badge d'entrée ce jour-là était géolocalisé
  // au dépôt" — seul cas où on substitue l'heure de badge d'entrée par
  // l'heure planifiée pour ce jour.
  interface DayBadges {
    sessions: BadgeEntry[];
    geoMatchedDepot: boolean;
  }
  const badgesByDriverDay = new Map<string, DayBadges>();
  for (const b of (badgeData ?? []) as BadgeEntry[]) {
    const key = `${b.user_id}|${parisCalendarDate(b.clocked_in_at)}`;
    const dayData = badgesByDriverDay.get(key) ?? { sessions: [], geoMatchedDepot: false };
    dayData.sessions.push(b);
    const point = b.clock_in_lat !== null && b.clock_in_lng !== null ? { lat: Number(b.clock_in_lat), lng: Number(b.clock_in_lng) } : null;
    if (classifyLocation(point, depotsFor(b.user_id), null) === "depot") dayData.geoMatchedDepot = true;
    badgesByDriverDay.set(key, dayData);
  }

  const hoursByDriver = new Map<string, number>();
  for (const [key, dayData] of badgesByDriverDay) {
    const driverId = key.split("|")[0] ?? key;
    const plannedStart = plannedStartByDriverDay.get(key);
    let dayHours: number;
    if (dayData.geoMatchedDepot && plannedStart) {
      const lastClockOut = dayData.sessions.reduce((latest, s) => (s.clocked_out_at > latest ? s.clocked_out_at : latest), "");
      dayHours = Math.max((new Date(lastClockOut).getTime() - new Date(plannedStart).getTime()) / 3_600_000, 0);
    } else {
      dayHours = dayData.sessions.reduce(
        (total, s) => total + Math.max((new Date(s.clocked_out_at).getTime() - new Date(s.clocked_in_at).getTime()) / 3_600_000, 0),
        0,
      );
    }
    hoursByDriver.set(driverId, (hoursByDriver.get(driverId) ?? 0) + dayHours);
  }
  // Repli tournée : seulement pour les jours absents de
  // badgesByDriverDay (aucun badge du tout ce jour-là) — un jour qui a
  // déjà des badges passe toujours par la branche ci-dessus, jamais
  // les deux sources cumulées pour le même jour.
  for (const [key, spans] of planningSpansByDriverDay) {
    if (badgesByDriverDay.has(key)) continue;
    const driverId = key.split("|")[0] ?? key;
    if (estEnArret(arretsParSalarie.get(driverId) ?? [], key.split("|")[1] ?? "")) continue;
    const dayHours = spans.reduce(
      (total, s) => total + Math.max((new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 3_600_000, 0),
      0,
    );
    hoursByDriver.set(driverId, (hoursByDriver.get(driverId) ?? 0) + dayHours);
  }

  const toursByDriver = new Map<string, number>();
  for (const t of (toursData ?? []) as DoneTour[]) {
    if (!t.driver_id) continue;
    toursByDriver.set(t.driver_id, (toursByDriver.get(t.driver_id) ?? 0) + 1);
  }

  const contractByDriver = new Map((contracts ?? []).map((c) => [c.user_id, c]));

  const rows = (drivers ?? [])
    .filter((d) => !selectedDriver || d.id === selectedDriver)
    .map((d) => {
      const contract = contractByDriver.get(d.id);
      const monthlyGross = contract?.monthly_gross_salary !== undefined && contract.monthly_gross_salary !== null ? Number(contract.monthly_gross_salary) : null;
      const monthlyNet = contract?.monthly_net_salary !== undefined && contract.monthly_net_salary !== null ? Number(contract.monthly_net_salary) : null;
      const contractualHours = contract ? Number(contract.contractual_monthly_hours) : 151.67;
      const rates = computeHourlyRates({
        monthlyGrossSalary: monthlyGross,
        monthlyNetSalary: monthlyNet,
        contractualMonthlyHours: contractualHours,
      });
      return {
        driver_id: d.id,
        full_name: d.full_name,
        monthly_gross_salary: monthlyGross,
        monthly_net_salary: monthlyNet,
        contractual_monthly_hours: contractualHours,
        hourly_rates: rates,
        tours_count: toursByDriver.get(d.id) ?? 0,
        worked_hours: hoursByDriver.get(d.id) ?? 0,
        payslip_generated: generatedDriverIds.includes(d.id),
        ...(() => {
          const p = heuresPrevuesDuMois(contractualHours, month, arretsParSalarie.get(d.id) ?? []);
          return { stoppage_days: p.joursArret, planned_hours: p.heures };
        })(),
      };
    });

  return (
    <div>
      <PageHeader
        title="Heures & salaires"
        description="Heures travaillées × taux horaire — départ planning/arrivée badgée au dépôt si géolocalisée, sinon badge entrée → badge sortie, ou horaire de la tournée si aucun badge ce jour-là. Le taux est à ajuster au cas par cas selon le contrat de chaque chauffeur."
      />
      <PayrollFilters month={month} drivers={(drivers ?? []).map((d) => ({ id: d.id, full_name: d.full_name }))} selectedDriver={selectedDriver} />
      {rows.length === 0 ? (
        <EmptyState title="Aucun chauffeur" description="Aucun chauffeur actif à afficher." />
      ) : (
        <PayrollTable rows={rows} payslipsEnabled={payslipsEnabled} periodStart={monthStart} periodEnd={periodEnd} />
      )}
    </div>
  );
}
