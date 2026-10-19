import "server-only";
import { statutValide, type StatutValidation } from "@/lib/paie/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parametresLegauxAu, FRAIS_CONVENTIONNELS } from "@/lib/paie/parametres";
import { HEURES_EQUIVALENCE } from "@/lib/paie/calcul";
import { countWeekdays } from "@/lib/business/payroll";
import { PRESENCE_STATUS } from "@/lib/organization/poles";
import type { ParametresEntreprise, ParametresLegaux, ProfilSalarie, RegimeTransport, VariablesMois } from "@/lib/paie/types";

/** "2026-10" → bornes du mois (fin incluse). */
export function bornesMois(mois: string): { debut: string; fin: string } {
  const [y, m] = mois.split("-").map(Number) as [number, number];
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { debut: `${mois}-01`, fin };
}

export function moisValide(mois: string | undefined): mois is string {
  return Boolean(mois && /^\d{4}-(0[1-9]|1[0-2])$/.test(mois));
}

export async function parametresEntreprise(supabase: SupabaseClient, organizationId: string): Promise<ParametresEntreprise> {
  const { data: p } = await supabase.from("payroll_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  return {
    effectif: p?.headcount ?? 1,
    tauxAccidentTravail: Number(p?.accident_rate ?? 0),
    tauxVersementMobilite: Number(p?.mobility_rate ?? 0),
    prevoyance: { salarial: Number(p?.prevoyance_salarial_rate ?? 0), patronal: Number(p?.prevoyance_patronal_rate ?? 0) },
    mutuelle: { salarial: Number(p?.mutuelle_salarial_amount ?? 0), patronal: Number(p?.mutuelle_patronal_amount ?? 0) },
    frais: {
      repas: Number(p?.meal_allowance ?? FRAIS_CONVENTIONNELS.repas),
      repasUnique: Number(p?.single_meal_allowance ?? FRAIS_CONVENTIONNELS.repasUnique),
      cassecroute: Number(p?.snack_allowance ?? FRAIS_CONVENTIONNELS.cassecroute),
      grandDeplacement: Number(p?.overnight_allowance ?? FRAIS_CONVENTIONNELS.grandDeplacement),
    },
  };
}

export interface ContextePaie {
  mois: string;
  debut: string;
  fin: string;
  legal: ParametresLegaux;
  entreprise: ParametresEntreprise;
  salarie: ProfilSalarie;
  profilComplet: boolean;
  coefficient: string | null;
  /** Variables préremplies depuis GODAC (tournées, congés) — modifiables avant calcul. */
  prefill: VariablesMois & { joursTravailles: number };
  cumuls: { brut: number; netImposable: number; heuresSupExonerees: number };
  bulletinExistant: {
    id: string;
    variables: VariablesMois | null;
    validation: StatutValidation;
    commentaire: string | null;
    valideLe: string | null;
  } | null;
}

/**
 * Tout ce qu'il faut pour préparer le bulletin d'un salarié pour un mois :
 * paramètres légaux à la date, réglages entreprise, profil de paie (avec
 * des valeurs par défaut tirées de l'ancien contrat /payroll quand le
 * profil n'existe pas encore), heures des tournées du mois, congés
 * validés et cumuls des bulletins déjà calculés cette année.
 */
export async function contextePaie(supabase: SupabaseClient, organizationId: string, userId: string, mois: string): Promise<ContextePaie> {
  const { debut, fin } = bornesMois(mois);
  const finExclue = new Date(Date.parse(`${fin}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  // Les tournées sont des instants UTC : une marge d'une journée de
  // chaque côté, puis tri par date de Paris.
  const avant = new Date(Date.parse(`${debut}T00:00:00Z`) - 86_400_000).toISOString();
  const apres = new Date(Date.parse(`${finExclue}T00:00:00Z`) + 86_400_000).toISOString();

  const [entreprise, { data: profil }, { data: contrat }, { data: tours }, { data: conges }, { data: anterieurs }, { data: existant }, { data: precedent }] = await Promise.all([
    parametresEntreprise(supabase, organizationId),
    supabase.from("payroll_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_contracts").select("monthly_gross_salary, contractual_monthly_hours").eq("user_id", userId).maybeSingle(),
    supabase
      .from("planning_entries")
      .select("start_at, end_at, status")
      .eq("organization_id", organizationId)
      .eq("driver_id", userId)
      // Tournées terminées, et présences planifiées des pôles bureau
      // (secrétariat, comptabilité… — lib/organization/poles.ts).
      .in("status", ["done", PRESENCE_STATUS])
      .gte("start_at", avant)
      .lt("start_at", apres),
    supabase
      .from("leave_requests")
      .select("start_date, end_date")
      .eq("driver_id", userId)
      .eq("status", "approved")
      .lte("start_date", fin)
      .gte("end_date", debut),
    supabase
      .from("payslips")
      .select("gross_amount, net_taxable, overtime_exempt")
      .eq("user_id", userId)
      // Cumuls annuels : seuls les bulletins validés par la direction comptent.
      .eq("validation_status", "valide")
      .gte("period_start", `${mois.slice(0, 4)}-01-01`)
      .lt("period_start", debut),
    supabase
      .from("payslips")
      .select("id, variables, validation_status, validation_comment, validated_at")
      .eq("user_id", userId)
      .eq("period_start", debut)
      .eq("period_end", fin)
      .maybeSingle(),
    // Dernier bulletin antérieur : on y reprend les retenues récurrentes (saisies, ATD, pension, prêt).
    // Jamais reprises d'un bulletin non validé (en attente ou refusé).
    supabase
      .from("payslips")
      .select("variables")
      .eq("user_id", userId)
      .eq("validation_status", "valide")
      .lt("period_start", debut)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const regime = (profil?.regime ?? "courte_distance") as RegimeTransport;
  const heuresContrat = Number(profil?.contractual_hours ?? contrat?.contractual_monthly_hours ?? HEURES_EQUIVALENCE[regime]);
  const tauxContrat = contrat?.monthly_gross_salary && contrat?.contractual_monthly_hours ? Number(contrat.monthly_gross_salary) / Number(contrat.contractual_monthly_hours) : null;
  const tauxHoraire = Number(profil?.hourly_rate ?? tauxContrat ?? 0);

  const paris = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));
  // Une présence ne compte qu'une fois la journée terminée : le planning
  // d'un jour à venir n'est pas encore du temps travaillé.
  const maintenant = Date.now();
  const toursMois = (tours ?? []).filter(
    (t) =>
      t.end_at &&
      paris(t.start_at) >= debut &&
      paris(t.start_at) <= fin &&
      (t.status !== PRESENCE_STATUS || Date.parse(t.end_at) <= maintenant),
  );
  const heuresTours = toursMois.reduce((h, t) => h + Math.max(0, (Date.parse(t.end_at!) - Date.parse(t.start_at)) / 3_600_000), 0);
  const joursTravailles = new Set(toursMois.map((t) => paris(t.start_at))).size;

  const d0 = new Date(`${debut}T00:00:00Z`);
  const d1 = new Date(`${fin}T00:00:00Z`);
  const joursConges = (conges ?? []).reduce((n, c) => {
    const s = new Date(Math.max(Date.parse(`${c.start_date}T00:00:00Z`), d0.getTime()));
    const e = new Date(Math.min(Date.parse(`${c.end_date}T00:00:00Z`), d1.getTime()));
    return n + countWeekdays(s, e);
  }, 0);

  const cumuls = (anterieurs ?? []).reduce(
    (c, p) => ({
      brut: c.brut + Number(p.gross_amount ?? 0),
      netImposable: c.netImposable + Number(p.net_taxable ?? 0),
      heuresSupExonerees: c.heuresSupExonerees + Number(p.overtime_exempt ?? 0),
    }),
    { brut: 0, netImposable: 0, heuresSupExonerees: 0 },
  );

  return {
    mois,
    debut,
    fin,
    legal: parametresLegauxAu(debut),
    entreprise,
    salarie: {
      regime,
      cadre: Boolean(profil?.is_cadre),
      tauxHoraire: Math.round(tauxHoraire * 10000) / 10000,
      heuresContractuelles: heuresContrat,
      tauxPas: profil?.pas_rate !== null && profil?.pas_rate !== undefined ? Number(profil.pas_rate) : null,
    },
    profilComplet: Boolean(profil?.hourly_rate),
    coefficient: profil?.coefficient ?? null,
    prefill: {
      heuresTravaillees: toursMois.length ? Math.round(heuresTours * 100) / 100 : null,
      heuresAbsenceNonPayee: 0,
      joursCongesPris: joursConges,
      primes: [],
      nbRepas: joursTravailles,
      nbRepasUnique: 0,
      nbCasseCroute: 0,
      nbGrandDeplacement: 0,
      retenues: ((precedent?.variables as VariablesMois | null)?.retenues ?? []).filter((r) => r.type !== "acompte"),
      personnesACharge: (precedent?.variables as VariablesMois | null)?.personnesACharge ?? 0,
      cumulHeuresSupExonereesAnnee: cumuls.heuresSupExonerees,
      joursTravailles,
    },
    cumuls,
    bulletinExistant: existant
      ? {
          id: existant.id,
          variables: (existant.variables as VariablesMois | null) ?? null,
          validation: statutValide(existant.validation_status),
          commentaire: (existant.validation_comment as string | null) ?? null,
          valideLe: (existant.validated_at as string | null) ?? null,
        }
      : null,
  };
}
