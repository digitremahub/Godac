import type { CodePays } from "@/lib/pays/pays";

/**
 * Règles de repos et de durée du travail contrôlées par GODAC, par pays.
 * Fichier pur. Ce sont des AVERTISSEMENTS, jamais des blocages : la
 * convention collective, l'accord d'entreprise ou un régime dérogatoire
 * (transport routier, chronotachygraphe) peut fixer d'autres seuils. Chaque
 * avertissement affiché porte la mention MENTION_A_VALIDER.
 */
export const MENTION_A_VALIDER = "à valider avec votre expert paie / convention collective";

/** Repos quotidien minimal entre deux journées de travail (directive 2003/88/CE, art. 3). */
export const REPOS_QUOTIDIEN_MIN_HEURES_UE = 11;
/** Amplitude maximale d'une journée : 24 h moins le repos quotidien minimal. */
export const AMPLITUDE_MAX_HEURES_UE = 24 - REPOS_QUOTIDIEN_MIN_HEURES_UE;
/** Durée maximale hebdomadaire de travail (directive 2003/88/CE, art. 6). */
export const DUREE_HEBDO_MAX_HEURES_UE = 48;
/** Jours travaillés consécutifs au-delà desquels le repos hebdomadaire manque (6 jours de travail, 1 jour de repos). */
export const JOURS_CONSECUTIFS_MAX_UE = 6;
/** Au-delà de cette durée de travail continu, une pause est attendue (même seuil que l'alerte « sans pause » des heures de paie). */
export const PAUSE_APRES_HEURES_UE = 6;

export interface ReglesTempsTravail {
  reposQuotidienMinHeures: number;
  amplitudeMaxHeures: number;
  dureeHebdoMaxHeures: number;
  joursConsecutifsMax: number;
  pauseApresHeures: number;
}

export const REGLES_FRANCE: ReglesTempsTravail = {
  reposQuotidienMinHeures: REPOS_QUOTIDIEN_MIN_HEURES_UE,
  amplitudeMaxHeures: AMPLITUDE_MAX_HEURES_UE,
  dureeHebdoMaxHeures: DUREE_HEBDO_MAX_HEURES_UE,
  joursConsecutifsMax: JOURS_CONSECUTIFS_MAX_UE,
  pauseApresHeures: PAUSE_APRES_HEURES_UE,
};

/** Socle de la directive 2003/88/CE (et son équivalent britannique), repris tel quel hors de France. */
const REGLES_SOCLE_EUROPEEN: ReglesTempsTravail = { ...REGLES_FRANCE };

/**
 * Pays contrôlés. Un pays absent (Suisse, Maroc, Tunisie, Algérie…) n'a
 * aucun contrôle : GODAC ne connaît pas ses règles et n'en invente pas.
 */
export const REGLES_TEMPS_TRAVAIL: Partial<Record<CodePays, ReglesTempsTravail>> = {
  FR: REGLES_FRANCE,
  BE: REGLES_SOCLE_EUROPEEN,
  LU: REGLES_SOCLE_EUROPEEN,
  DE: REGLES_SOCLE_EUROPEEN,
  ES: REGLES_SOCLE_EUROPEEN,
  IT: REGLES_SOCLE_EUROPEEN,
  PT: REGLES_SOCLE_EUROPEEN,
  NL: REGLES_SOCLE_EUROPEEN,
  GB: REGLES_SOCLE_EUROPEEN,
};

/** Règles du pays, ou null si GODAC n'en contrôle aucune. */
export function reglesTempsTravail(code: string | null | undefined): ReglesTempsTravail | null {
  return REGLES_TEMPS_TRAVAIL[(code ?? "FR") as CodePays] ?? null;
}
