/**
 * Regroupements du tableau de bord et des documents TICPE — pur, testé.
 */

import { totaliser, type LigneTicpe, type Totaux } from "@/lib/ticpe/montant";
import type { CategorieTicpe, ZoneTicpe } from "@/lib/ticpe/bareme";

export function grouperPar<K extends string>(lignes: readonly LigneTicpe[], cle: (l: LigneTicpe) => K | null): Map<K, Totaux> {
  const groupes = new Map<K, LigneTicpe[]>();
  for (const l of lignes) {
    if (l.statut === "exclu") continue;
    const k = cle(l);
    if (k === null) continue;
    const g = groupes.get(k) ?? [];
    g.push(l);
    groupes.set(k, g);
  }
  return new Map([...groupes.entries()].map(([k, g]) => [k, totaliser(g)]));
}

/** Par véhicule (lignes comptées ou « taux manquant »). */
export function parVehicule(lignes: readonly LigneTicpe[]): Map<string, Totaux> {
  return grouperPar(lignes, (l) => l.vehicle_id);
}

/** Par mois AAAA-MM. */
export function parMois(lignes: readonly LigneTicpe[]): Map<string, Totaux> {
  return grouperPar(lignes, (l) => l.jour.slice(0, 7));
}

export interface LigneRecap {
  categorie: CategorieTicpe;
  zone: ZoneTicpe;
  taux: number | null;
  pleins: number;
  litres: number;
  hectolitres: number;
  montant: number;
}

/**
 * Récapitulatif pour l'annexe 3310-TIC : volumes retenus (après
 * plafond) en hectolitres et montant, par activité, zone et taux.
 * Les lignes « taux manquant » forment leur propre groupe (taux null).
 */
export function recapitulatif3310(lignes: readonly LigneTicpe[]): LigneRecap[] {
  const groupes = new Map<string, LigneRecap>();
  for (const l of lignes) {
    if (l.statut === "exclu" || !l.categorie || !l.zone) continue;
    const k = `${l.categorie}|${l.zone}|${l.taux ?? "?"}`;
    const g = groupes.get(k) ?? { categorie: l.categorie, zone: l.zone, taux: l.taux, pleins: 0, litres: 0, hectolitres: 0, montant: 0 };
    g.pleins += 1;
    g.litres += l.litresRetenus;
    g.montant += l.montant;
    groupes.set(k, g);
  }
  return [...groupes.values()]
    .map((g) => ({ ...g, litres: Math.round(g.litres * 100) / 100, hectolitres: Math.round(g.litres) / 100, montant: Math.round(g.montant * 100) / 100 }))
    .sort((a, b) => a.categorie.localeCompare(b.categorie) || a.zone.localeCompare(b.zone) || (a.taux ?? 0) - (b.taux ?? 0));
}
