import "server-only";
import { statutValide, type StatutValidation } from "@/lib/paie/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parametresLegauxAu, FRAIS_CONVENTIONNELS, MODELE_TRANSPORT } from "@/lib/paie/parametres";
import { HEURES_EQUIVALENCE } from "@/lib/paie/calcul";
import { countWeekdays } from "@/lib/business/payroll";
import { PRESENCE_STATUS } from "@/lib/organization/poles";
import { acomptesDuBulletin, type AcomptesDuBulletin } from "@/lib/paie/acomptes";
import { acomptesJusquAu } from "@/lib/paie/acomptes-serveur";
import { periodesDuMois, soldeConges, type Reprise, type SoldeConges } from "@/lib/paie/conges";
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
  // Pas encore de réglages : modèle transport (IDCC 16) par défaut.
  if (!p) return { ...MODELE_TRANSPORT.entreprise, prevoyance: { ...MODELE_TRANSPORT.entreprise.prevoyance }, mutuelle: { ...MODELE_TRANSPORT.entreprise.mutuelle }, santePmss: { ...MODELE_TRANSPORT.entreprise.santePmss }, conventionnelles: { ...MODELE_TRANSPORT.entreprise.conventionnelles }, dfs: { ...MODELE_TRANSPORT.entreprise.dfs }, frais: { ...MODELE_TRANSPORT.entreprise.frais } };
  const nombre = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  // Colonnes du modèle transport (migration 20261024000003) : absentes = modèle par défaut.
  const ccnSal = "ccn_salarial_rate" in p ? nombre(p.ccn_salarial_rate) : MODELE_TRANSPORT.entreprise.conventionnelles.salarial;
  const ccnPat = "ccn_patronal_rate" in p ? nombre(p.ccn_patronal_rate) : MODELE_TRANSPORT.entreprise.conventionnelles.patronal;
  const santeSal = nombre(p.health_pmss_salarial_rate);
  const santePat = nombre(p.health_pmss_patronal_rate);
  return {
    conventionnelles: ccnSal !== null || ccnPat !== null ? { salarial: ccnSal ?? 0, patronal: ccnPat ?? 0 } : null,
    santePmss: santeSal !== null || santePat !== null ? { salarial: santeSal ?? 0, patronal: santePat ?? 0 } : null,
    dfs: { taux: nombre(p.dfs_rate) ?? MODELE_TRANSPORT.entreprise.dfs.taux, active: Boolean(p.dfs_enabled) },
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
  /**
   * Acomptes acceptés à déduire de ce bulletin (lignes « Acompte du
   * JJ/MM »), relus en base : jamais saisis ni repris du navigateur.
   */
  acomptes: AcomptesDuBulletin;
  /** Compteurs de congés payés N-1 / N à la fin du mois (pied de bulletin). */
  conges: SoldeConges;
  /** Solde de reprise saisi au profil (N-1, N, date). */
  repriseConges: Reprise | null;
  /** Cumuls de l'année pour le pied de bulletin (bulletins validés antérieurs). */
  cumulsPied: { heures: number; heuresSup: number; brut: number; plafondSs: number; netImposable: number; chargesPatronales: number; coutGlobal: number; totalVerse: number; allegements: number };
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
 * des valeurs par défaut tirées de l'ancien contrat /equipe/paie/heures quand le
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

  const [entreprise, { data: profil }, { data: contrat }, { data: tours }, { data: conges }, { data: anterieurs }, { data: existant }, { data: precedent }, demandesAcompte] = await Promise.all([
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
      .select("gross_amount, net_taxable, overtime_exempt, net_amount, employer_cost, details")
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
    // Demandes d'acompte acceptées jusqu'à ce mois (lib/paie/acomptes.ts).
    acomptesJusquAu(supabase, userId, debut),
  ]);
  // Congés validés des deux dernières périodes : compteurs N-1 / N.
  const { data: congesValides } = await supabase
    .from("leave_requests")
    .select("start_date, end_date")
    .eq("driver_id", userId)
    .eq("status", "approved")
    .gte("end_date", `${Number(mois.slice(0, 4)) - 2}-06-01`)
    .lte("start_date", fin);

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

  type Details = { heures?: { base?: number; sup25?: number; sup50?: number }; reductionGenerale?: number; totalPatronal?: number; brut?: number } | null;
  const cumulsPied = (anterieurs ?? []).reduce(
    (c, p) => {
      const d = (p.details ?? null) as Details;
      return {
        heures: c.heures + Number(d?.heures?.base ?? 0) + Number(d?.heures?.sup25 ?? 0) + Number(d?.heures?.sup50 ?? 0),
        heuresSup: c.heuresSup + Number(d?.heures?.sup25 ?? 0) + Number(d?.heures?.sup50 ?? 0),
        brut: c.brut + Number(p.gross_amount ?? 0),
        plafondSs: c.plafondSs + parametresLegauxAu(debut).pmss,
        netImposable: c.netImposable + Number(p.net_taxable ?? 0),
        chargesPatronales: c.chargesPatronales + Number(d?.totalPatronal ?? 0),
        coutGlobal: c.coutGlobal + Number(p.employer_cost ?? 0),
        totalVerse: c.totalVerse + Number(p.net_amount ?? 0),
        allegements: c.allegements + Number(d?.reductionGenerale ?? 0),
      };
    },
    { heures: 0, heuresSup: 0, brut: 0, plafondSs: 0, netImposable: 0, chargesPatronales: 0, coutGlobal: 0, totalVerse: 0, allegements: 0 },
  );
  const repriseConges: Reprise | null =
    profil?.leave_balance_date && (profil.leave_balance_n1 !== null || profil.leave_balance_n !== null)
      ? { au: String(profil.leave_balance_date), n1: Number(profil.leave_balance_n1 ?? 0), n: Number(profil.leave_balance_n ?? 0) }
      : null;
  const listeConges = (congesValides ?? []).map((c) => ({ du: String(c.start_date), au: String(c.end_date) }));
  const compteursConges = soldeConges({ reprise: repriseConges, aujourdhui: fin, valides: listeConges.filter((c) => c.du <= fin) });

  const cumuls = (anterieurs ?? []).reduce(
    (c, p) => ({
      brut: c.brut + Number(p.gross_amount ?? 0),
      netImposable: c.netImposable + Number(p.net_taxable ?? 0),
      heuresSupExonerees: c.heuresSupExonerees + Number(p.overtime_exempt ?? 0),
    }),
    { brut: 0, netImposable: 0, heuresSupExonerees: 0 },
  );

  const acomptes = acomptesDuBulletin({
    demandes: demandesAcompte,
    mois,
    bulletin: existant ? { id: existant.id, valide: statutValide(existant.validation_status) === "valide" } : null,
  });

  return {
    mois,
    debut,
    fin,
    legal: parametresLegauxAu(debut),
    entreprise,
    salarie: {
      regime,
      cadre: Boolean(profil?.is_cadre),
      groupe: (profil?.job_group as string | null | undefined) ?? null,
      tauxRepas: profil?.meal_rate === null || profil?.meal_rate === undefined ? null : Number(profil.meal_rate),
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
      // Reprises du mois précédent (bulletin validé), à vérifier : primes
      // et taux du panier. Les heures sup. et les congés sont propres au mois.
      primes: ((precedent?.variables as VariablesMois | null)?.primes ?? []).filter((p) => p.montant),
      tauxRepas: (precedent?.variables as VariablesMois | null)?.tauxRepas ?? null,
      heuresSup25: null,
      heuresSup50: null,
      // Congés validés du mois, avec leurs dates, en jours ouvrables.
      periodesConges: periodesDuMois(listeConges, debut, fin),
      nbRepas: joursTravailles,
      nbRepasUnique: 0,
      nbCasseCroute: 0,
      nbGrandDeplacement: 0,
      retenues: ((precedent?.variables as VariablesMois | null)?.retenues ?? []).filter((r) => r.type !== "acompte" && !r.demandeId).concat(acomptes.retenues),
      personnesACharge: (precedent?.variables as VariablesMois | null)?.personnesACharge ?? 0,
      cumulHeuresSupExonereesAnnee: cumuls.heuresSupExonerees,
      joursTravailles,
    },
    cumuls,
    acomptes,
    conges: compteursConges,
    repriseConges,
    cumulsPied,
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
