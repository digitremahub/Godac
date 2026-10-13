/**
 * PMP = Prix Moyen Pondéré d'une cuve, recalculé à chaque LIVRAISON :
 * miroir pur du trigger before_tank_delivery (migration 121), testé ici
 * indépendamment de la base. Un plein (sortie de cuve) ne change pas le
 * PMP : il est valorisé à ce prix. Stock négatif (livraisons manquantes)
 * compté comme 0, pour que le prix de la livraison s'impose.
 *
 * La base reste la source de vérité : cette fonction ne sert qu'à
 * prévisualiser et à tester la formule.
 */
export function computeDeliveryPmp(
  tank: { stockLiters: number; pmp: number | null },
  delivery: { liters: number; unitPrice: number },
): number {
  if (delivery.liters <= 0) {
    throw new Error("liters must be positive to compute a PMP");
  }
  const stock = Math.max(tank.stockLiters, 0);
  if (tank.pmp === null || stock === 0) return roundTo(delivery.unitPrice, 4);
  return roundTo((stock * tank.pmp + delivery.liters * delivery.unitPrice) / (stock + delivery.liters), 4);
}

export function isPriceAnomalous(
  unitPrice: number,
  currentPmp: number,
  thresholdRatio = 0.15,
): boolean {
  if (currentPmp <= 0) return false;
  const deviation = Math.abs(unitPrice - currentPmp) / currentPmp;
  return deviation > thresholdRatio;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
