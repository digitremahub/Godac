/**
 * Facturation par palier d'utilisateurs (application GODAC Livreur) —
 * grille dans module_user_tiers (migration 116). Pur, partagé entre le
 * serveur (facturation) et les pages tarifs.
 */
export interface PalierUtilisateurs {
  module_key: string;
  min_users: number;
  max_users: number | null;
  monthly_price: number;
  extra_per_user: number;
}

/** Modules facturés au palier d'utilisateurs plutôt qu'au forfait. */
export const MODULES_PAR_PALIER = ["route_optimizer"] as const;

export function palierPour(paliers: PalierUtilisateurs[], moduleKey: string, utilisateurs: number): PalierUtilisateurs | null {
  const grille = paliers.filter((p) => p.module_key === moduleKey).sort((a, b) => a.min_users - b.min_users);
  if (!grille.length) return null;
  const n = Math.max(1, utilisateurs);
  return grille.find((p) => n >= p.min_users && (p.max_users === null || n <= p.max_users)) ?? grille[grille.length - 1]!;
}

/** Prix mensuel HT du module pour ce nombre d'utilisateurs (null : pas de grille). */
export function prixPalier(paliers: PalierUtilisateurs[], moduleKey: string, utilisateurs: number): number | null {
  const p = palierPour(paliers, moduleKey, utilisateurs);
  if (!p) return null;
  // Palier ouvert : supplément par utilisateur au-delà du seuil (100 → 129 €, 101 → 130 €).
  const supplement = p.max_users === null ? Math.max(0, utilisateurs - p.min_users) * Number(p.extra_per_user) : 0;
  return Math.round((Number(p.monthly_price) + supplement) * 100) / 100;
}

/** « 6 à 15 utilisateurs », « 101 utilisateurs et plus ». */
export function libellePalier(p: Pick<PalierUtilisateurs, "min_users" | "max_users">): string {
  if (p.max_users === null) return `${p.min_users} utilisateurs et plus`;
  return p.min_users <= 1 ? `jusqu'à ${p.max_users} utilisateurs` : `${p.min_users} à ${p.max_users} utilisateurs`;
}
