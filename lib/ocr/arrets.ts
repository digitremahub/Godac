/**
 * Arrêts de LIVRAISON d'une tournée à partir des rapports scannés.
 *
 * Le document du transporteur imprime un total de stops (stops_scan) qui
 * inclut les stops de ramasse. Les ramasses sont inscrites à la main sur
 * la feuille (lues par l'OCR si lisibles) ou saisies par le chauffeur à
 * la fin de tournée — la saisie du retour fait foi. Arrêts de livraison =
 * stops du scan − ramasses.
 */
export interface LectureArrets {
  /** Total de stops imprimé sur le scan, ramasses comprises. */
  stops_scan?: number | null;
  /** Arrêts de livraison déjà calculés (anciennes lectures : total brut). */
  stops_total?: number | null;
  pickups?: number | null;
}

export function arretsLivraison(depart: LectureArrets | null | undefined, retour: LectureArrets | null | undefined): number | null {
  const brut = retour?.stops_scan ?? depart?.stops_scan ?? null;
  const ramasses = retour?.pickups ?? depart?.pickups ?? null;
  if (brut !== null) return Math.max(0, brut - (ramasses ?? 0));
  // Lectures antérieures sans total brut : stops_total contenait le total imprimé.
  const ancien = retour?.stops_total ?? depart?.stops_total ?? null;
  if (ancien === null) return null;
  return Math.max(0, ancien - (ramasses ?? 0));
}
