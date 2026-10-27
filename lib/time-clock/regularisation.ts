import { addDays, parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";

/**
 * Régularisation d'un pointage oublié. Fichier pur (aucune dépendance
 * serveur), testé dans lib/time-clock/__tests__/regularisation.test.ts.
 *
 * Une entrée restée ouverte (sortie oubliée) est close chaque nuit par le
 * cron /api/cron/rh-quotidien avec une sortie ESTIMÉE, marquée « à
 * régulariser ». Sans cela, le bouton du lendemain s'inverserait : le
 * premier tap fermerait l'entrée de la veille. L'encadrement corrige
 * ensuite l'heure (motif obligatoire, trace d'audit).
 */

/** Une entrée ouverte depuis plus longtemps que cela est close (sortie oubliée). */
export const DUREE_MAX_ENTREE_OUVERTE_HEURES = 16;
/** Une journée de travail ne dépasse jamais cela : au-delà, la correction est refusée (deux pointages manquent). */
export const DUREE_MAX_CORRECTION_HEURES = 24;
export const MOTIF_MIN = 3;
export const MOTIF_MAX = 500;
/** Jours ouvrés par semaine pour déduire la durée prévue d'une journée des heures du contrat. */
const JOURS_PAR_SEMAINE = 5;

const HEURE = 3_600_000;

export type SourceEstimation = "planning" | "duree_prevue" | "a_saisir";

export const LIBELLE_SOURCE_ESTIMATION: Record<SourceEstimation, string> = {
  planning: "fin planifiée de la tournée",
  duree_prevue: "entrée + durée prévue",
  a_saisir: "à saisir (aucune estimation possible)",
};

/** L'entrée ouverte doit-elle être close ? Ouverte depuis plus de 16 h, ou d'un jour (de Paris) précédent. */
export function entreeAClore(clockedInAt: string, maintenant: Date): boolean {
  const entree = Date.parse(clockedInAt);
  if (Number.isNaN(entree)) return false;
  if (maintenant.getTime() - entree > DUREE_MAX_ENTREE_OUVERTE_HEURES * HEURE) return true;
  return parisCalendarDate(clockedInAt) < parisCalendarDate(maintenant.toISOString());
}

/** Durée prévue d'une journée (minutes) d'après les heures mensuelles du contrat (ex. 151,67 h → 7 h). Inconnue : null. */
export function dureeJourPrevueMinutes(heuresMensuelles: number | null | undefined): number | null {
  if (!heuresMensuelles || heuresMensuelles <= 0 || !Number.isFinite(heuresMensuelles)) return null;
  const parSemaine = (heuresMensuelles * 12) / 52;
  const minutes = Math.round((parSemaine / JOURS_PAR_SEMAINE) * 60);
  return minutes > 0 && minutes <= DUREE_MAX_ENTREE_OUVERTE_HEURES * 60 ? minutes : null;
}

export interface Estimation {
  /** Instant ISO de la sortie estimée ; null : à saisir (l'entrée est close à son propre instant, durée nulle). */
  sortie: string | null;
  source: SourceEstimation;
}

/**
 * Heure de sortie estimée : fin planifiée de la tournée ou du planning si
 * elle est plausible (après l'entrée, dans les 16 h, déjà passée), sinon
 * entrée + durée prévue, sinon à saisir.
 */
export function estimerSortie(p: { entree: string; finsPlanifiees: readonly (string | null)[]; dureePrevueMinutes: number | null; maintenant: Date }): Estimation {
  const e = Date.parse(p.entree);
  const plafond = Math.min(e + DUREE_MAX_ENTREE_OUVERTE_HEURES * HEURE, p.maintenant.getTime());
  const fins = p.finsPlanifiees
    .filter((f): f is string => Boolean(f))
    .map((f) => Date.parse(f))
    .filter((f) => !Number.isNaN(f) && f > e && f <= plafond);
  if (fins.length) return { sortie: new Date(Math.max(...fins)).toISOString(), source: "planning" };
  if (p.dureePrevueMinutes) {
    const prevue = e + p.dureePrevueMinutes * 60_000;
    if (prevue <= p.maintenant.getTime()) return { sortie: new Date(prevue).toISOString(), source: "duree_prevue" };
  }
  return { sortie: null, source: "a_saisir" };
}

export type VerdictCorrection = { ok: true; sortie: string; motif: string } | { ok: false; erreur: string };

/** Contrôle d'une correction : heure de sortie valide, après l'entrée, pas dans le futur, motif obligatoire. */
export function validerCorrection(p: { entree: string; sortie: string; motif: string | null | undefined; maintenant: Date }): VerdictCorrection {
  const motif = (p.motif ?? "").trim();
  if (motif.length < MOTIF_MIN) return { ok: false, erreur: "Le motif de la correction est obligatoire." };
  if (motif.length > MOTIF_MAX) return { ok: false, erreur: `Le motif est limité à ${MOTIF_MAX} caractères.` };
  const e = Date.parse(p.entree);
  const s = Date.parse(p.sortie);
  if (Number.isNaN(s)) return { ok: false, erreur: "Heure de sortie invalide." };
  if (s <= e) return { ok: false, erreur: "La sortie doit être après l'entrée." };
  if (s > p.maintenant.getTime() + 5 * 60_000) return { ok: false, erreur: "La sortie ne peut pas être dans le futur." };
  if (s - e > DUREE_MAX_CORRECTION_HEURES * HEURE) return { ok: false, erreur: `Plus de ${DUREE_MAX_CORRECTION_HEURES} h entre l'entrée et la sortie : un pointage est probablement manquant.` };
  return { ok: true, sortie: new Date(s).toISOString(), motif };
}

/**
 * Sortie saisie en heure de Paris (« HH:MM ») le jour de l'entrée, ou le
 * lendemain si l'heure est avant l'entrée (équipe de nuit). Renvoie l'instant ISO.
 */
export function sortieDepuisHeureParis(entree: string, heure: string): string | null {
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(heure.trim())) return null;
  const jour = parisCalendarDate(entree);
  const memeJour = parisWallTimeToUtcISOString(jour, heure.trim());
  if (Date.parse(memeJour) > Date.parse(entree)) return memeJour;
  return parisWallTimeToUtcISOString(addDays(jour, 1), heure.trim());
}

/** Ligne de la liste « Pointages à régulariser ». */
export interface PointageARegulariser {
  id: string;
  userId: string;
  nom: string;
  entree: string;
  sortieEstimee: string | null;
  source: SourceEstimation | null;
  /** Clôturé automatiquement par la nuit (sinon : encore ouvert, à clore). */
  clos: boolean;
}

/** Message au salarié : « sortie à confirmer ». */
export function messageSortieAConfirmer(p: { sortieEstimee: string | null; source: SourceEstimation | null }): string {
  if (!p.sortieEstimee) return "Sortie oubliée : votre responsable va saisir l'heure de sortie.";
  const heure = new Date(p.sortieEstimee).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `Sortie à confirmer : estimée au ${heure} (${p.source ? LIBELLE_SOURCE_ESTIMATION[p.source] : "estimation"}). Votre responsable la confirme ou la corrige.`;
}
