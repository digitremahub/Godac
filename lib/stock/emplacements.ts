/**
 * Zones et emplacements (fichier pur, testé dans lib/stock/__tests__/emplacements.test.ts).
 * Un dépôt contient des zones (quai, zone, allée, rayonnage, retours), qui contiennent des emplacements.
 */
export const TYPES_ZONE = ["quai", "zone", "allee", "rayonnage", "retour", "autre"] as const;
export type TypeZone = (typeof TYPES_ZONE)[number];

export const LIBELLES_TYPE_ZONE: Record<TypeZone, string> = {
  quai: "Quai",
  zone: "Zone",
  allee: "Allée",
  rayonnage: "Rayonnage",
  retour: "Zone de retours",
  autre: "Autre",
};

export interface EmplacementLu {
  id: string;
  site_id: string;
  parent_id: string | null;
  genre: "zone" | "emplacement";
  type_zone: TypeZone | null;
  code: string;
  libelle: string | null;
  actif: boolean;
}

/** « Quai 3 › Q3-01 » : zone puis emplacement, pour les listes déroulantes. */
export function libelleEmplacement(e: EmplacementLu, tous: readonly EmplacementLu[]): string {
  const nom = e.libelle ? `${e.code} (${e.libelle})` : e.code;
  if (e.genre === "zone") return nom;
  const zone = tous.find((z) => z.id === e.parent_id);
  return zone ? `${zone.code} › ${nom}` : nom;
}

/** Zones d'un dépôt puis leurs emplacements, dans l'ordre des codes ; les désactivés sont masqués sauf demande. */
export function arborescence(site_id: string, tous: readonly EmplacementLu[], avecInactifs = false): { zone: EmplacementLu; emplacements: EmplacementLu[] }[] {
  const parCode = (a: EmplacementLu, b: EmplacementLu) => a.code.localeCompare(b.code, "fr", { numeric: true });
  const visibles = tous.filter((e) => e.site_id === site_id && (avecInactifs || e.actif));
  return visibles
    .filter((e) => e.genre === "zone")
    .sort(parCode)
    .map((zone) => ({ zone, emplacements: visibles.filter((e) => e.parent_id === zone.id).sort(parCode) }));
}

/** Choix proposés pour ranger une unité : emplacements actifs d'abord, puis zones sans emplacement. */
export function choixRangement(site_id: string, tous: readonly EmplacementLu[]): { id: string; libelle: string }[] {
  const res: { id: string; libelle: string }[] = [];
  for (const { zone, emplacements } of arborescence(site_id, tous)) {
    if (emplacements.length === 0) res.push({ id: zone.id, libelle: libelleEmplacement(zone, tous) });
    for (const e of emplacements) res.push({ id: e.id, libelle: libelleEmplacement(e, tous) });
  }
  return res;
}
