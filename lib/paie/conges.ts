// Compteurs de congés payés (N-1 et N) — logique pure, partagée par la
// paie (pied de bulletin, congés du mois) et les demandes de congés
// (solde affiché au salarié, alerte « solde insuffisant » à la direction).
// Testée dans lib/paie/__tests__/conges.test.ts.
//
// Règles retenues (simples, documentées) :
// - acquisition : 2,5 jours ouvrables par mois civil écoulé (travail
//   effectif présumé), plafonnée à 30 jours par période ;
// - période de référence : 1er juin → 31 mai. Au 1er juin, le solde N
//   devient N-1 ; un reliquat N-1 non pris est reporté (la direction le
//   régularise si besoin) ;
// - jours ouvrables : lundi → samedi, hors jours fériés ;
// - pris : congés validés (leave_requests « approved »), imputés d'abord
//   sur N-1 puis sur N ; en attente : demandes « pending » ;
// - point de départ : le solde de reprise saisi dans le profil de paie
//   (ex. N-1 : 5, N : 5 au 30/09, d'après le dernier bulletin). Sans
//   reprise, compteurs à zéro au 1er juin de la période en cours.

export const ACQUIS_PAR_MOIS = 2.5;
export const PLAFOND_ANNUEL = 30;

const jour = (d: Date) => d.toISOString().slice(0, 10);
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Dimanche de Pâques (algorithme de Butcher), AAAA-MM-JJ. */
export function paques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const j = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
}

const cacheFeries = new Map<number, Set<string>>();
/** Jours fériés de métropole d'une année. */
export function joursFeries(annee: number): Set<string> {
  const deja = cacheFeries.get(annee);
  if (deja) return deja;
  const p = date(paques(annee));
  const decale = (n: number) => jour(new Date(p.getTime() + n * 86_400_000));
  const feries = new Set([
    `${annee}-01-01`,
    decale(1), // lundi de Pâques
    `${annee}-05-01`,
    `${annee}-05-08`,
    decale(39), // Ascension
    decale(50), // lundi de Pentecôte
    `${annee}-07-14`,
    `${annee}-08-15`,
    `${annee}-11-01`,
    `${annee}-11-11`,
    `${annee}-12-25`,
  ]);
  cacheFeries.set(annee, feries);
  return feries;
}

/** Jours ouvrables (lundi → samedi, hors fériés) entre deux dates incluses. */
export function joursOuvrables(du: string, au: string): number {
  if (!du || !au || au < du) return 0;
  let n = 0;
  for (let d = date(du); jour(d) <= au.slice(0, 10); d = new Date(d.getTime() + 86_400_000)) {
    if (d.getUTCDay() === 0) continue;
    if (joursFeries(d.getUTCFullYear()).has(jour(d))) continue;
    n++;
  }
  return n;
}

/** Début (1er juin) de la période de référence contenant la date. */
export function debutPeriode(iso: string): string {
  const a = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 6 ? `${a}-06-01` : `${a - 1}-06-01`;
}

/** Dernier jour du mois d'une date. */
function finDeMois(iso: string): string {
  const d = date(iso);
  return jour(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)));
}

export interface Reprise {
  /** Date du solde de reprise (AAAA-MM-JJ), ex. fin du mois du dernier bulletin. */
  au: string;
  n1: number;
  n: number;
}

export interface Compteur {
  acquis: number;
  pris: number;
  solde: number;
}

export interface SoldeConges {
  n1: Compteur;
  n: Compteur;
  /** Solde N-1 + N. */
  disponible: number;
  /** Jours des demandes en attente. */
  enAttente: number;
  /** Disponible moins les demandes en attente. */
  disponibleApresAttente: number;
  /** Début de la période N (1er juin). */
  periodeN: string;
  repriseRenseignee: boolean;
}

export interface CongeDate {
  du: string;
  au: string;
}

/**
 * Compteurs à une date : reprise (ou zéro au début de la période),
 * + 2,5 j par mois civil terminé depuis, bascule au 1er juin, − congés
 * validés après la reprise. Les congés validés à venir sont déjà déduits.
 */
export function soldeConges(params: { reprise: Reprise | null; aujourdhui: string; valides: CongeDate[]; enAttente?: CongeDate[] }): SoldeConges {
  const { reprise, aujourdhui } = params;
  const origine = reprise ? reprise.au.slice(0, 10) : jour(new Date(date(debutPeriode(aujourdhui)).getTime() - 86_400_000));
  let periode = debutPeriode(jour(new Date(date(origine).getTime() + 86_400_000)));
  const n1: Compteur = { acquis: reprise ? Math.max(0, reprise.n1) : 0, pris: 0, solde: 0 };
  const n: Compteur = { acquis: reprise ? Math.max(0, reprise.n) : 0, pris: 0, solde: 0 };
  let acquisPeriode = 0;

  const basculer = (nouvelle: string) => {
    // Reliquat N-1 reporté, N devient N-1.
    n1.acquis = r2(n1.acquis - n1.pris + (n.acquis - n.pris));
    n1.pris = 0;
    n.acquis = 0;
    n.pris = 0;
    acquisPeriode = 0;
    periode = nouvelle;
  };

  // Mois civils terminés après l'origine, jusqu'à aujourd'hui.
  for (let fin = finDeMois(jour(new Date(date(origine).getTime() + 86_400_000))); fin <= aujourdhui; fin = finDeMois(jour(new Date(date(fin).getTime() + 86_400_000)))) {
    if (fin <= origine) continue;
    const p = debutPeriode(fin);
    if (p > periode) basculer(p);
    const ajout = Math.min(ACQUIS_PAR_MOIS, Math.max(0, PLAFOND_ANNUEL - acquisPeriode));
    n.acquis = r2(n.acquis + ajout);
    acquisPeriode += ajout;
  }
  const periodeCourante = debutPeriode(aujourdhui);
  if (periodeCourante > periode) basculer(periodeCourante);

  // Congés validés après l'origine : N-1 d'abord, puis N.
  let pris = 0;
  for (const c of params.valides) pris += joursOuvrables(c.du > origine ? c.du : jour(new Date(date(origine).getTime() + 86_400_000)), c.au);
  const surN1 = Math.min(pris, Math.max(0, n1.acquis));
  n1.pris = r2(surN1);
  n.pris = r2(pris - surN1);
  n1.solde = r2(n1.acquis - n1.pris);
  n.solde = r2(n.acquis - n.pris);

  const enAttente = (params.enAttente ?? []).reduce((t, c) => t + joursOuvrables(c.du, c.au), 0);
  const disponible = r2(n1.solde + n.solde);
  return { n1, n, disponible, enAttente, disponibleApresAttente: r2(disponible - enAttente), periodeN: periode, repriseRenseignee: Boolean(reprise) };
}

export interface VerdictDemande {
  jours: number;
  soldeApres: number;
  insuffisant: boolean;
  message: string;
}

/** Effet d'une demande sur le solde (les autres demandes en attente comptent déjà). */
export function verdictDemandeConges(solde: Pick<SoldeConges, "disponibleApresAttente">, du: string, au: string): VerdictDemande {
  const jours = joursOuvrables(du, au);
  const soldeApres = r2(solde.disponibleApresAttente - jours);
  const insuffisant = soldeApres < 0;
  return {
    jours,
    soldeApres,
    insuffisant,
    message: insuffisant
      ? `Solde insuffisant : il manque ${r2(-soldeApres)} jour${-soldeApres > 1 ? "s" : ""}. La demande reste possible (congé sans solde ou anticipé) ; la direction le verra.`
      : `Solde après demande : ${soldeApres} jour${soldeApres > 1 ? "s" : ""}.`,
  };
}

/** Périodes de congés validés comprises dans un mois, en jours ouvrables (pour le bulletin). */
export function periodesDuMois(conges: CongeDate[], debut: string, fin: string): { du: string; au: string; jours: number }[] {
  return conges
    .map((c) => ({ du: c.du < debut ? debut : c.du, au: c.au > fin ? fin : c.au }))
    .filter((c) => c.du <= c.au)
    .map((c) => ({ ...c, jours: joursOuvrables(c.du, c.au) }))
    .filter((c) => c.jours > 0)
    .sort((a, b) => a.du.localeCompare(b.du));
}
