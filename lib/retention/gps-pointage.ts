// Position GPS de pointage : durée de conservation et règles de lecture (pur, testé).
//
// Décision du 28/10/2026 : la position détaillée (latitude/longitude d'entrée
// et de sortie) n'est gardée que 2 mois, au titre de la preuve du temps de
// travail en cas de litige ; passé ce délai, les coordonnées sont mises à null
// et il ne reste que le résultat du pointage (heures, source, statut, sortie
// automatique, heure de dernière présence au dépôt). Annoncé dans
// app/confidentialite, app/dpa et app/cgu : garder les trois textes alignés.

/** Durée de conservation de la position GPS de pointage, en jours (≈ 2 mois). */
export const GPS_POINTAGE_JOURS = 60;

const JOUR_MS = 86_400_000;

/** Instant (ISO) avant lequel l'entrée d'un pointage a ses coordonnées effaçables. */
export function limiteGpsPointage(maintenant: Date = new Date()): string {
  return new Date(maintenant.getTime() - GPS_POINTAGE_JOURS * JOUR_MS).toISOString();
}

/** Les coordonnées d'un pointage commencé à cette date sont-elles encore conservées ? */
export function gpsPointageConserve(clockedInAt: string | Date, maintenant: Date = new Date()): boolean {
  const debut = clockedInAt instanceof Date ? clockedInAt.toISOString() : new Date(clockedInAt).toISOString();
  return debut >= limiteGpsPointage(maintenant);
}

/**
 * Le calcul des heures de paie (equipe/paie/heures) lit la position d'entrée
 * pour savoir si un badge a été donné au dépôt (heure planifiée substituée à
 * l'heure de badge). Un mois dont le dernier jour est plus ancien que la durée
 * de conservation n'a plus ces positions : la substitution n'est plus
 * possible et les heures sont calculées sur les seules heures de badge.
 */
export function moisSansPositions(finDeMois: string | Date, maintenant: Date = new Date()): boolean {
  return !gpsPointageConserve(finDeMois, maintenant);
}
