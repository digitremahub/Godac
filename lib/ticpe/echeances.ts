/**
 * Périodes de déclaration TICPE, échéances, délai de réclamation et
 * « argent non réclamé » — pur, testé. Jours au format AAAA-MM-JJ
 * (calendrier de Paris).
 *
 * Depuis les consommations 2025, la demande se fait avec la déclaration
 * de TVA (annexe 3310-TIC de la CA3 mensuelle ou trimestrielle, ou avec
 * la CA12 annuelle). Les consommations de l'année N sont réclamables
 * jusqu'au 31/12/N+2.
 */

import type { RegimeTva, ReglagesTicpe } from "@/lib/ticpe/reglages";

export interface PeriodeDeclaration {
  /** « 2026-03 », « 2026-T1 », « 2026 ». */
  cle: string;
  debut: string;
  fin: string;
  libelle: string;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const pad = (n: number) => String(n).padStart(2, "0");
const finDuMois = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m : 1..12

export function periodeContenant(jour: string, regime: RegimeTva): PeriodeDeclaration {
  const y = Number(jour.slice(0, 4));
  const m = Number(jour.slice(5, 7));
  if (regime === "mensuel") return { cle: `${y}-${pad(m)}`, debut: `${y}-${pad(m)}-01`, fin: `${y}-${pad(m)}-${pad(finDuMois(y, m))}`, libelle: `${MOIS[m - 1]} ${y}` };
  if (regime === "trimestriel") {
    const t = Math.ceil(m / 3);
    const m1 = (t - 1) * 3 + 1;
    const m3 = m1 + 2;
    return { cle: `${y}-T${t}`, debut: `${y}-${pad(m1)}-01`, fin: `${y}-${pad(m3)}-${pad(finDuMois(y, m3))}`, libelle: `${t === 1 ? "1er" : `${t}e`} trimestre ${y}` };
  }
  return { cle: `${y}`, debut: `${y}-01-01`, fin: `${y}-12-31`, libelle: `année ${y}` };
}

/** Lendemain / veille d'un jour. */
export function decalerJour(jour: string, n: number): string {
  const [y, m, d] = jour.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function periodePrecedente(p: PeriodeDeclaration, regime: RegimeTva): PeriodeDeclaration {
  return periodeContenant(decalerJour(p.debut, -1), regime);
}

export function periodeSuivante(p: PeriodeDeclaration, regime: RegimeTva): PeriodeDeclaration {
  return periodeContenant(decalerJour(p.fin, 1), regime);
}

function estOuvre(jour: string): boolean {
  const j = new Date(`${jour}T12:00:00Z`).getUTCDay();
  const md = jour.slice(5);
  return j !== 0 && j !== 6 && md !== "05-01" && md !== "05-08";
}

/** CA12 : par défaut le 2e jour ouvré qui suit le 1er mai (à confirmer par l'expert-comptable). */
export function dateLimiteCa12ParDefaut(annee: number): string {
  let jour = `${annee}-05-01`;
  let ouvres = 0;
  while (ouvres < 2) {
    jour = decalerJour(jour, 1);
    if (estOuvre(jour)) ouvres += 1;
  }
  return jour;
}

/**
 * Jour du mois suivant retenu par défaut pour le dépôt de la CA3 quand l'entreprise n'a rien réglé.
 * Valeur PRUDENTE (avant la fin du mois), pas une règle : la date réelle dépend de l'entreprise
 * (à confirmer selon votre date de dépôt de TVA) et se règle dans les réglages TICPE.
 */
export const JOUR_LIMITE_CA3_PAR_DEFAUT = 20;

/**
 * Date limite de dépôt de la déclaration qui porte la demande de la
 * période : CA3 → le jour réglé du mois qui suit la période (par défaut
 * le 20, à confirmer selon la date de dépôt de TVA) ; CA12 → l'année suivante (MM-JJ réglé,
 * sinon début mai).
 */
export function dateLimite(p: PeriodeDeclaration, regime: RegimeTva, reglages: Pick<ReglagesTicpe, "jour_limite_depot" | "date_limite_ca12">): string {
  if (regime === "annuel_ca12") {
    const annee = Number(p.fin.slice(0, 4)) + 1;
    if (reglages.date_limite_ca12) {
      const [m, d] = reglages.date_limite_ca12.split("-").map(Number) as [number, number];
      return `${annee}-${pad(m)}-${pad(Math.min(d, finDuMois(annee, m)))}`;
    }
    return dateLimiteCa12ParDefaut(annee);
  }
  const lendemain = decalerJour(p.fin, 1);
  const y = Number(lendemain.slice(0, 4));
  const m = Number(lendemain.slice(5, 7));
  const dernier = finDuMois(y, m);
  const jour = Math.min(reglages.jour_limite_depot ?? JOUR_LIMITE_CA3_PAR_DEFAUT, dernier);
  return `${y}-${pad(m)}-${pad(jour)}`;
}

export function joursEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export interface Echeance {
  periode: PeriodeDeclaration;
  dateLimite: string;
  joursRestants: number;
}

/**
 * Prochaine échéance : la période terminée la plus ancienne dont la date
 * limite n'est pas passée, sinon celle de la période en cours.
 */
export function prochaineEcheance(aujourdhui: string, reglages: Pick<ReglagesTicpe, "regime_tva" | "jour_limite_depot" | "date_limite_ca12">): Echeance {
  const regime = reglages.regime_tva;
  const enCours = periodeContenant(aujourdhui, regime);
  const precedente = periodePrecedente(enCours, regime);
  const limitePrec = dateLimite(precedente, regime, reglages);
  const p = limitePrec >= aujourdhui ? precedente : enCours;
  const dl = p === precedente ? limitePrec : dateLimite(enCours, regime, reglages);
  return { periode: p, dateLimite: dl, joursRestants: joursEntre(aujourdhui, dl) };
}

/** Dernier jour pour réclamer les consommations d'une année : 31/12/N+2. */
export function dateLimiteReclamation(annee: number): string {
  return `${annee + 2}-12-31`;
}

/** Une période est-elle encore réclamable (consommations de l'année N jusqu'au 31/12/N+2) ? */
export function encoreReclamable(p: PeriodeDeclaration, aujourdhui: string): boolean {
  return aujourdhui <= dateLimiteReclamation(Number(p.debut.slice(0, 4)));
}

/** Périodes terminées et encore réclamables, de la plus ancienne à la plus récente (au plus tôt : 2025, première année DGFiP). */
export function periodesReclamables(aujourdhui: string, regime: RegimeTva, anneeMin = 2025): PeriodeDeclaration[] {
  const annee = Math.max(anneeMin, Number(aujourdhui.slice(0, 4)) - 2);
  const res: PeriodeDeclaration[] = [];
  let p = periodeContenant(`${annee}-01-01`, regime);
  while (p.fin < aujourdhui) {
    if (encoreReclamable(p, aujourdhui)) res.push(p);
    p = periodeSuivante(p, regime);
  }
  return res;
}

export interface Declaration {
  periode_debut: string;
  periode_fin: string;
  annulee_le?: string | null;
}

/** Période couverte par une déclaration non annulée. */
export function estDeclaree(p: Pick<PeriodeDeclaration, "debut" | "fin">, declarations: readonly Declaration[]): boolean {
  return declarations.some((d) => !d.annulee_le && d.periode_debut <= p.debut && d.periode_fin >= p.fin);
}

export interface NonReclame {
  periode: PeriodeDeclaration;
  montant: number;
  dateLimiteReclamation: string;
}

/**
 * « Argent non réclamé » : périodes terminées, encore réclamables, non
 * déclarées, dont le montant calculé est positif.
 */
export function argentNonReclame(
  montantDe: (p: PeriodeDeclaration) => number,
  declarations: readonly Declaration[],
  aujourdhui: string,
  regime: RegimeTva,
): { periodes: NonReclame[]; total: number } {
  const periodes = periodesReclamables(aujourdhui, regime)
    .filter((p) => !estDeclaree(p, declarations))
    .map((p) => ({ periode: p, montant: Math.round(montantDe(p) * 100) / 100, dateLimiteReclamation: dateLimiteReclamation(Number(p.debut.slice(0, 4))) }))
    .filter((x) => x.montant > 0);
  return { periodes, total: Math.round(periodes.reduce((n, x) => n + x.montant, 0) * 100) / 100 };
}

/** Mois (AAAA-MM) d'une période, pour le détail mensuel. */
export function moisDeLaPeriode(p: Pick<PeriodeDeclaration, "debut" | "fin">): string[] {
  const res: string[] = [];
  let y = Number(p.debut.slice(0, 4));
  let m = Number(p.debut.slice(5, 7));
  while (`${y}-${pad(m)}` <= p.fin.slice(0, 7)) {
    res.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return res;
}

export function libelleMois(mois: string): string {
  return `${MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`;
}

/** Rappel ERA : en janvier, pour l'année précédente (à établir au plus tard le 31 janvier). */
export function rappelEra(aujourdhui: string): { annee: number; dateLimite: string } | null {
  if (aujourdhui.slice(5, 7) !== "01") return null;
  const annee = Number(aujourdhui.slice(0, 4)) - 1;
  return { annee, dateLimite: `${annee + 1}-01-31` };
}
