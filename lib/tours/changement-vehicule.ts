import { z } from "zod";

/**
 * Changement de véhicule (hors dépannage) : le chauffeur qui récupère le
 * véhicule photographie l'habitacle, le tableau de bord et le tour du
 * véhicule. Ces photos datent l'état du véhicule à chaque passage de main
 * (migration 117) pour savoir qui a fait les dégâts.
 */
export const PHOTOS_CHANGEMENT = [
  { kind: "habitacle", libelle: "Habitacle" },
  { kind: "tableau_de_bord", libelle: "Tableau de bord" },
  { kind: "avant", libelle: "Avant" },
  { kind: "arriere", libelle: "Arrière" },
  { kind: "cote_gauche", libelle: "Côté gauche" },
  { kind: "cote_droit", libelle: "Côté droit" },
] as const;

export type TypePhotoChangement = (typeof PHOTOS_CHANGEMENT)[number]["kind"];
export type TypeChangement = "changement" | "depannage";

export const photoChangementSchema = z.object({
  kind: z.enum(PHOTOS_CHANGEMENT.map((p) => p.kind) as [TypePhotoChangement, ...TypePhotoChangement[]]),
  path: z.string().min(1),
});
export type PhotoChangement = z.infer<typeof photoChangementSchema>;

/** Photos encore à prendre (aucune pour un dépannage). */
export function photosManquantes(type: TypeChangement | undefined, photos: { kind: string }[] | undefined): TypePhotoChangement[] {
  if (type === "depannage") return [];
  const prises = new Set((photos ?? []).map((p) => p.kind));
  return PHOTOS_CHANGEMENT.filter((p) => !prises.has(p.kind)).map((p) => p.kind);
}

export function libellePhoto(kind: string): string {
  return PHOTOS_CHANGEMENT.find((p) => p.kind === kind)?.libelle ?? kind;
}
