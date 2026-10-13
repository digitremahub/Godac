/** Lieu de dépôt d'un colis livré, et ceux qui exigent une photo. */
export const LIEUX_LIVRAISON = [
  { key: "main_propre", label: "En main propre", photo: false },
  { key: "boite_aux_lettres", label: "Boîte aux lettres", photo: true },
  { key: "jardin", label: "Jardin / terrasse", photo: true },
  { key: "voisin", label: "Chez un voisin", photo: false },
  { key: "autre", label: "Autre lieu sûr", photo: false },
] as const;

export type LieuLivraison = (typeof LIEUX_LIVRAISON)[number]["key"];

export const photoObligatoire = (lieu: LieuLivraison) => LIEUX_LIVRAISON.some((l) => l.key === lieu && l.photo);
export const libelleLieu = (lieu: string | null) => LIEUX_LIVRAISON.find((l) => l.key === lieu)?.label ?? null;
