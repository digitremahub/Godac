import "server-only";
import { statutValide, type StatutValidation } from "@/lib/paie/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parametresLegauxAu, FRAIS_CONVENTIONNELS, MAINTIEN_LEGAL, MODELE_TRANSPORT } from "@/lib/paie/parametres";
import { HEURES_EQUIVALENCE, salaireMensuelContrat } from "@/lib/paie/calcul";
import { calculerSortie } from "@/lib/paie/sortie";
import { countWeekdays } from "@/lib/business/payroll";
import { PRESENCE_STATUS } from "@/lib/organization/poles";
import { acomptesDuBulletin, type AcomptesDuBulletin } from "@/lib/paie/acomptes";
import { acomptesJusquAu } from "@/lib/paie/acomptes-serveur";
import { debutPeriode, natureAbsenceConges, periodesDuMois, soldeConges, type Reprise, type SoldeConges } from "@/lib/paie/conges";
import { estConducteur } from "@/lib/roles/conducteurs";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { heuresDuMois, sourceHeures, type AbsenceJours, type EntreePlanning, type HeuresDuMois, type Pointage } from "@/lib/paie/heures";
import type { ArretTravail, ElementsSortie, MotifSortie, ParametresEntreprise, ParametresLegaux, ParametresMaintien, ProfilSalarie, RegimeTransport, TypeArret, VariablesMois } from "@/lib/paie/types";

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
  // Maintien conventionnel (migration 20261026000002) : absent = légal seul.
  const maintien: ParametresMaintien | null =
    "sick_pay_rate_1" in p
      ? {
          ancienneteMinMois: nombre(p.sick_pay_min_seniority_months) ?? MAINTIEN_LEGAL.ancienneteMinMois,
          carenceMaladie: nombre(p.sick_pay_waiting_days) ?? MAINTIEN_LEGAL.carenceMaladie,
          carenceAt: nombre(p.sick_pay_waiting_days_at) ?? MAINTIEN_LEGAL.carenceAt,
          taux1: nombre(p.sick_pay_rate_1) ?? MAINTIEN_LEGAL.taux1,
          taux2: nombre(p.sick_pay_rate_2) ?? MAINTIEN_LEGAL.taux2,
          dureeBase: nombre(p.sick_pay_base_days) ?? MAINTIEN_LEGAL.dureeBase,
          dureeIncrement: nombre(p.sick_pay_step_days) ?? MAINTIEN_LEGAL.dureeIncrement,
          trancheAnnees: nombre(p.sick_pay_step_years) ?? MAINTIEN_LEGAL.trancheAnnees,
          dureeMax: nombre(p.sick_pay_max_days) ?? MAINTIEN_LEGAL.dureeMax,
        }
      : null;
  const santeSal = nombre(p.health_pmss_salarial_rate);
  const santePat = nombre(p.health_pmss_patronal_rate);
  return {
    maintien,
    subrogation: Boolean(p.subrogation_enabled),
    // Source des heures (migration 20261030000001) : absente = règle par défaut.
    sourceHeures: sourceHeures(p.hours_source),
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
  /**
   * Heures du mois jour par jour (source retenue : pointage, planning
   * prévu, retour de tournée) et alertes de contrôle — lib/paie/heures.ts.
   */
  controleHeures: HeuresDuMois;
  /** Arrêts refusés par l'encadrement : retirés d'un bulletin déjà généré. */
  arretsRefuses: string[];
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
  /** Sortie enregistrée (employee_exits) et son calcul ; `elements` seulement le mois de la sortie. */
  sortie: {
    enregistrement: LigneSortie;
    duMois: boolean;
    elements: ElementsSortie;
    indemniteLegale: number | null;
    avertissements: string[];
  } | null;
  /** Date d'entrée (employee_files). */
  dateEntree: string | null;
  cumulsPied: { heures: number; heuresSup: number; brut: number; plafondSs: number; netImposable: number; chargesPatronales: number; coutGlobal: number; totalVerse: number; allegements: number };
  bulletinExistant: {
    id: string;
    variables: VariablesMois | null;
    validation: StatutValidation;
    commentaire: string | null;
    valideLe: string | null;
  } | null;
}

export interface LigneSortie {
  exit_date: string;
  reason: MotifSortie;
  notice_type: "effectue" | "paye" | "non_paye" | "sans";
  notice_days: number | null;
  notice_amount: number | null;
  severance_amount: number | null;
  jobs_held: string | null;
  notes: string | null;
}

/** Arrêt de work_stoppages → arrêt du moteur. */
export function arretDepuisLigne(l: Record<string, unknown>): ArretTravail {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(l.id),
    type: String(l.stoppage_type) as TypeArret,
    du: String(l.start_date),
    au: String(l.end_date),
    prolongationDu: (l.extension_of as string | null) ?? null,
    ijssBrutesJour: n(l.daily_ijss_gross),
    ijssNettesJour: n(l.daily_ijss_net),
    joursIjss: n(l.ijss_days),
    maintienManuel: n(l.manual_maintenance),
  };
}

/**
 * Affectations du salarié sur la période (UTC, marges comprises), avec le
 * début prévu (planned_start_at, migration 20261030000001 ; absent : null).
 */
async function planningDuMois(supabase: SupabaseClient, organizationId: string, userId: string, avant: string, apres: string): Promise<EntreePlanning[]> {
  const requete = (colonnes: string) =>
    supabase.from("planning_entries").select(colonnes).eq("organization_id", organizationId).eq("driver_id", userId).gte("start_at", avant).lt("start_at", apres);
  let r = await requete("start_at, end_at, status, planned_start_at");
  if (r.error && estSchemaManquant(r.error)) r = await requete("start_at, end_at, status");
  return ((r.data ?? []) as unknown as { start_at: string; end_at: string | null; status: string; planned_start_at?: string | null }[]).map((e) => ({
    debut: e.start_at,
    debutPrevu: e.planned_start_at ?? (e.status === "planned" || e.status === PRESENCE_STATUS ? e.start_at : null),
    fin: e.end_at,
    status: e.status,
  }));
}

const decaleMois = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12)).toISOString().slice(0, 10);
};

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

  const [entreprise, { data: profil }, { data: contrat }, tours, { data: conges }, { data: anterieurs }, { data: existant }, { data: precedent }, demandesAcompte] = await Promise.all([
    parametresEntreprise(supabase, organizationId),
    supabase.from("payroll_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_contracts").select("monthly_gross_salary, contractual_monthly_hours").eq("user_id", userId).maybeSingle(),
    // Tournées, affectations prévues et présences des pôles bureau
    // (lib/organization/poles.ts), avec le début prévu quand il est connu.
    planningDuMois(supabase, organizationId, userId, avant, apres),
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
  // Arrêts, sortie, date d'entrée, bulletins validés des deux dernières
  // années (dixième, salaire de référence). Tables de la migration
  // 20261026000002 absentes : erreurs ignorées, sans arrêt ni sortie.
  const depuis = `${Number(mois.slice(0, 4)) - 2}-06-01`;
  const [arretsLignes, sortieLigne, { data: dossier }, { data: historique }, { data: pointagesBruts }, { data: compte }] = await Promise.all([
    supabase.from("work_stoppages").select("*").eq("user_id", userId).gte("end_date", depuis).lte("start_date", fin).order("start_date"),
    supabase.from("employee_exits").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("employee_files").select("hire_date").eq("user_id", userId).maybeSingle(),
    supabase
      .from("payslips")
      .select("period_start, gross_amount, ijss:details->ijssBrutes")
      .eq("user_id", userId)
      .eq("validation_status", "valide")
      .gte("period_start", depuis)
      .lt("period_start", debut)
      .order("period_start"),
    // Pointages du mois (direction, comptable : RLS « time_clock »).
    supabase.from("time_clock_entries").select("clocked_in_at, clocked_out_at").eq("user_id", userId).gte("clocked_in_at", avant).lt("clocked_in_at", apres),
    supabase.from("users").select("role, can_drive").eq("id", userId).maybeSingle(),
  ]);
  const pointages: Pointage[] = ((pointagesBruts ?? []) as { clocked_in_at: string; clocked_out_at: string | null }[]).map((p) => ({ entree: p.clocked_in_at, sortie: p.clocked_out_at }));
  // Arrêts refusés par l'encadrement (migration 20261030000001) : ni paie, ni heures.
  const lignesArrets = (arretsLignes.error ? [] : (arretsLignes.data ?? [])) as Record<string, unknown>[];
  const arretsRefuses = lignesArrets.filter((l) => l.status === "refuse").map((l) => String(l.id));
  const arretsTous = lignesArrets.filter((l) => l.status !== "refuse").map((l) => arretDepuisLigne(l));
  const dateEntree = (dossier?.hire_date as string | null | undefined) ?? null;
  const bulletinsValides = (historique ?? []).map((p) => ({
    debut: String(p.period_start),
    // Brut hors IJSS reprises en subrogation.
    brut: Math.max(0, Number(p.gross_amount ?? 0) - Number((p as { ijss?: unknown }).ijss ?? 0)),
  }));
  const brutEntre = (du: string, au: string) => {
    const l = bulletinsValides.filter((b) => b.debut >= du && b.debut <= au);
    return { brut: Math.round(l.reduce((t, b) => t + b.brut, 0) * 100) / 100, nombre: l.length };
  };
  // Dixième : période de référence close (1er juin – 31 mai précédents).
  const finRef = new Date(Date.parse(`${debutPeriode(debut)}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const debutRef = `${Number(finRef.slice(0, 4)) - 1}-06-01`;
  const ref = brutEntre(debutRef, finRef);
  const cpReference = ref.nombre > 0 && ref.brut > 0 ? { brut: ref.brut, joursAcquis: Math.min(30, ref.nombre * 2.5), du: debutRef, au: finRef } : null;

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

  // Heures du mois : pointage, sinon planning prévu / retour de tournée
  // (conducteurs), pointage seul (bureau) ; jours d'arrêt et de congé
  // sans heure attendue (lib/paie/heures.ts).
  const absencesHeures: AbsenceJours[] = [
    ...arretsTous.map((a) => ({ du: a.du, au: a.au, nature: "arret" as const })),
    ...(conges ?? []).map((c) => ({ du: String(c.start_date), au: String(c.end_date), nature: "conges" as const })),
  ];
  const controleHeures = heuresDuMois({
    debut,
    fin,
    pointages: pointages ?? [],
    planning: tours,
    absences: absencesHeures,
    profil: { conducteur: estConducteur(String(compte?.role ?? ""), compte?.can_drive as boolean | null | undefined) },
    source: entreprise.sourceHeures,
  });
  const joursTravailles = controleHeures.joursTravailles;

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
  const absencesConges = arretsTous.map((a) => ({ du: a.du, au: a.au, nature: natureAbsenceConges(a.type) }));
  const compteursConges = soldeConges({ reprise: repriseConges, aujourdhui: fin, valides: listeConges.filter((c) => c.du <= fin), absences: absencesConges });

  const cumuls = (anterieurs ?? []).reduce(
    (c, p) => ({
      brut: c.brut + Number(p.gross_amount ?? 0),
      netImposable: c.netImposable + Number(p.net_taxable ?? 0),
      heuresSupExonerees: c.heuresSupExonerees + Number(p.overtime_exempt ?? 0),
    }),
    { brut: 0, netImposable: 0, heuresSupExonerees: 0 },
  );

  const salarie: ProfilSalarie = {
    regime,
    cadre: Boolean(profil?.is_cadre),
    groupe: (profil?.job_group as string | null | undefined) ?? null,
    tauxRepas: profil?.meal_rate === null || profil?.meal_rate === undefined ? null : Number(profil.meal_rate),
    tauxHoraire: Math.round(tauxHoraire * 10000) / 10000,
    heuresContractuelles: heuresContrat,
    tauxPas: profil?.pas_rate !== null && profil?.pas_rate !== undefined ? Number(profil.pas_rate) : null,
    dateEntree,
  };
  const legal = parametresLegauxAu(debut);

  // Sortie : éléments calculés à la date de sortie (ICCP, préavis, indemnité).
  let sortie: ContextePaie["sortie"] = null;
  const ls = sortieLigne.error ? null : (sortieLigne.data as Record<string, unknown> | null);
  if (ls?.exit_date) {
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const enregistrement: LigneSortie = {
      exit_date: String(ls.exit_date),
      reason: String(ls.reason) as MotifSortie,
      notice_type: (String(ls.notice_type ?? "sans") as LigneSortie["notice_type"]),
      notice_days: n(ls.notice_days),
      notice_amount: n(ls.notice_amount),
      severance_amount: n(ls.severance_amount),
      jobs_held: (ls.jobs_held as string | null) ?? null,
      notes: (ls.notes as string | null) ?? null,
    };
    const dateSortie = enregistrement.exit_date;
    const soldeSortie = soldeConges({ reprise: repriseConges, aujourdhui: dateSortie, valides: listeConges.filter((c) => c.du <= dateSortie), absences: absencesConges });
    // Mois en cours de sortie : acquisition au prorata non comptée (simplifié).
    const douzeMois = bulletinsValides.filter((b) => b.debut >= decaleMois(dateSortie, -12) && b.debut < decaleMois(dateSortie, 0));
    const anneePrecedente = brutEntre(`${Number(dateSortie.slice(0, 4)) - 1}-01-01`, `${Number(dateSortie.slice(0, 4)) - 1}-12-31`);
    const refSortie = brutEntre(`${Number(debutPeriode(dateSortie).slice(0, 4)) - 1}-06-01`, dateSortie);
    const calcul = calculerSortie(
      {
        date: dateSortie,
        motif: enregistrement.reason,
        entree: dateEntree,
        preavis: { type: enregistrement.notice_type, jours: enregistrement.notice_days, montant: enregistrement.notice_amount },
        montantRupture: enregistrement.severance_amount,
        joursCpRestants: Math.max(0, soldeSortie.disponible),
        salaireMensuel: salaireMensuelContrat(salarie),
        salairesMensuels: douzeMois.map((b) => b.brut),
        remunerationAnnuellePrecedente: anneePrecedente.brut,
        referenceCp: refSortie.nombre > 0 ? { brut: refSortie.brut, joursAcquis: Math.min(60, refSortie.nombre * 2.5) } : null,
      },
      parametresLegauxAu(dateSortie),
    );
    if (!douzeMois.length) calcul.avertissements.push("Aucun bulletin validé sur les 12 derniers mois : salaire de référence de l'indemnité de licenciement indisponible.");
    sortie = {
      enregistrement,
      duMois: dateSortie >= debut && dateSortie <= fin,
      elements: calcul.elements,
      indemniteLegale: calcul.licenciement?.montant ?? null,
      avertissements: calcul.avertissements,
    };
  }

  const acomptes = acomptesDuBulletin({
    demandes: demandesAcompte,
    mois,
    bulletin: existant ? { id: existant.id, valide: statutValide(existant.validation_status) === "valide" } : null,
  });

  return {
    mois,
    debut,
    fin,
    legal,
    entreprise,
    salarie,
    sortie,
    dateEntree,
    profilComplet: Boolean(profil?.hourly_rate),
    coefficient: profil?.coefficient ?? null,
    prefill: {
      heuresTravaillees: controleHeures.joursTravailles ? controleHeures.total : null,
      heuresAbsenceNonPayee: 0,
      joursCongesPris: joursConges,
      // Reprises du mois précédent (bulletin validé), à vérifier : primes
      // et taux du panier. Les heures sup. et les congés sont propres au mois.
      primes: ((precedent?.variables as VariablesMois | null)?.primes ?? []).filter((p) => p.montant),
      tauxRepas: (precedent?.variables as VariablesMois | null)?.tauxRepas ?? null,
      // Paiement : dernier jour du mois, par virement ; mode et type de
      // taux PAS repris du dernier bulletin validé.
      datePaiement: fin,
      modePaiement: (precedent?.variables as VariablesMois | null)?.modePaiement ?? "virement",
      typeTauxPas: (precedent?.variables as VariablesMois | null)?.typeTauxPas ?? null,
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
      // Arrêts du mois (work_stoppages), cumuls de référence CP, sortie.
      arrets: arretsTous.filter((a) => a.du <= fin && a.au >= debut),
      subrogation: null,
      cpReference,
      sortie: sortie?.duMois ? sortie.elements : null,
      joursTravailles,
    },
    controleHeures,
    arretsRefuses,
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
