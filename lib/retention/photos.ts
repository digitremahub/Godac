// Photos de preuve de livraison à effacer du stockage (purge RGPD). Pur, testé.

export interface PhotosArret {
  proof_photo_path?: string | null;
  proof_photo_paths?: string[] | null;
}

/** Taille d'un lot d'effacement dans le stockage. */
export const LOT_EFFACEMENT = 100;

/** Tous les chemins de photos des arrêts (liste complète et chemin simple), sans doublon ni valeur vide. */
export function cheminsPhotos(arrets: readonly PhotosArret[]): string[] {
  const chemins = new Set<string>();
  for (const a of arrets) {
    for (const c of [a.proof_photo_path, ...(a.proof_photo_paths ?? [])]) if (typeof c === "string" && c.trim()) chemins.add(c);
  }
  return [...chemins];
}

/** Découpe en lots pour l'API de stockage. */
export function enLots<T>(elements: readonly T[], taille: number = LOT_EFFACEMENT): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < elements.length; i += taille) lots.push(elements.slice(i, i + taille));
  return lots;
}
