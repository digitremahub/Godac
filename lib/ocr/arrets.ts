/**
 * Arrêts de LIVRAISON d'une tournée à partir des rapports scannés.
 *
 * Le document du transporteur imprime un total de stops qui inclut les
 * stops de ramasse ; l'OCR (lib/ocr/tour-report.ts) renvoie déjà
 * stops_total = stops du scan − ramasses quand les deux figurent sur le
 * même document. Quand les ramasses ne sont connues qu'au retour, on les
 * déduit ici du total lu au départ.
 */
export interface LectureArrets {
  stops_total?: number | null;
  pickups?: number | null;
}

export function arretsLivraison(depart: LectureArrets | null | undefined, retour: LectureArrets | null | undefined): number | null {
  // Le compte-rendu de retour porte à la fois les stops et les ramasses : il fait foi.
  if (retour?.stops_total != null) return retour.stops_total;
  if (depart?.stops_total == null) return null;
  if (depart.pickups != null) return depart.stops_total;
  if (retour?.pickups != null) return Math.max(0, depart.stops_total - retour.pickups);
  return depart.stops_total;
}
