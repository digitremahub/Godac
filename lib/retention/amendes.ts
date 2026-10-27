// Purge RGPD des amendes, partie pure (testée dans lib/retention/__tests__/amendes.test.ts).
//
// La page de confidentialité annonce : « Amendes : jusqu'à leur traitement,
// puis 1 an maximum (délai de prescription des contraventions) ». Une amende
// est traitée quand elle est réglée ou classée (fines.closed_at, migration
// 20261108000003) : un an après, ses pièces sont effacées du stockage, puis la
// ligne (les échanges liés partent avec elle, en cascade). Une amende en cours
// (à attribuer, attribuée, contestée) n'est jamais purgée.

/** Durée annoncée : un an après la clôture. */
export const RETENTION_AMENDES_JOURS = 365;

/** Statuts d'une amende traitée (clôturée). */
export const STATUTS_AMENDE_CLOTUREE = ["paid", "dismissed"] as const;

/** Instant (ISO) avant lequel une clôture est assez ancienne pour purger. */
export function limiteClotureAmendes(maintenant: Date = new Date()): string {
  return new Date(maintenant.getTime() - RETENTION_AMENDES_JOURS * 86_400_000).toISOString();
}

export interface AmendePurgeable {
  status: string;
  closed_at: string | null;
}

/** L'amende est-elle clôturée depuis plus d'un an ? */
export function estPurgeable(a: AmendePurgeable, maintenant: Date = new Date()): boolean {
  if (!(STATUTS_AMENDE_CLOTUREE as readonly string[]).includes(a.status) || !a.closed_at) return false;
  return a.closed_at < limiteClotureAmendes(maintenant);
}

export interface PiecesAmende {
  photo_path?: string | null;
  document_paths?: string[] | null;
}

/** Tous les chemins de pièces d'amendes (avis, pièces jointes) et de photos d'échanges, sans doublon ni valeur vide. */
export function cheminsAmendes(amendes: readonly PiecesAmende[], commentaires: readonly { photo_paths?: string[] | null }[] = []): string[] {
  const chemins = new Set<string>();
  const ajouter = (c: unknown) => {
    if (typeof c === "string" && c.trim()) chemins.add(c);
  };
  for (const a of amendes) {
    ajouter(a.photo_path);
    for (const c of a.document_paths ?? []) ajouter(c);
  }
  for (const c of commentaires) for (const p of c.photo_paths ?? []) ajouter(p);
  return [...chemins];
}
