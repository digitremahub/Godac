/**
 * Modèles de tournées récurrentes (planning_tour_templates) : jours de la
 * semaine (0 = dimanche … 6 = samedi, comme Date.getDay et la contrainte
 * planning_tour_templates_weekdays_check) et valeurs par défaut du
 * formulaire « + Nouveau modèle » (components/planning/PlanningTemplatesPanel.tsx).
 */

/** Ordre d'affichage : lundi → dimanche. */
export const JOURS_MODELE = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 0, label: "Dim" },
] as const;

/** Par défaut : du lundi au vendredi. */
export const JOURS_PAR_DEFAUT = [1, 2, 3, 4, 5];

/** Coche ou décoche un jour ; résultat sans doublon, trié (0…6). */
export function basculerJour(jours: number[], jour: number): number[] {
  const set = new Set(jours.filter((j) => Number.isInteger(j) && j >= 0 && j <= 6));
  if (set.has(jour)) set.delete(jour);
  else if (Number.isInteger(jour) && jour >= 0 && jour <= 6) set.add(jour);
  return [...set].sort((a, b) => a - b);
}

/** Résumé lisible : « Lun–Ven », « Tous les jours », « Lun, Mer, Sam »… */
export function resumeJours(jours: number[]): string {
  const set = new Set(jours);
  if (!set.size) return "Aucun jour";
  if (set.size === 7) return "Tous les jours";
  const ordre = JOURS_MODELE.filter((j) => set.has(j.value));
  // Suite continue dans l'ordre lundi → dimanche (3 jours ou plus) : « Lun–Ven ».
  const index = ordre.map((j) => JOURS_MODELE.findIndex((x) => x.value === j.value));
  const continu = index.every((v, i) => i === 0 || v === index[i - 1]! + 1);
  if (continu && ordre.length >= 3) return `${ordre[0]!.label}–${ordre.at(-1)!.label}`;
  return ordre.map((j) => j.label).join(", ");
}

/** Nom proposé pour un modèle d'après la tournée choisie. */
export function nomModeleParDefaut(tourNumber: string | null | undefined): string {
  const n = (tourNumber ?? "").trim();
  return n ? `Tournée n°${n}`.slice(0, 80) : "";
}

/** Raison pour laquelle « Générer » est grisé (null s'il est actif). */
export function raisonGenerationImpossible(etat: { serviceId: string; chargement: boolean; generation: boolean; modeles: number; coches: number }): string | null {
  if (etat.chargement || etat.generation) return null;
  if (!etat.serviceId) return "Choisissez un service.";
  if (!etat.modeles) return "Aucun modèle pour ce service : créez-en un avec « + Nouveau modèle ».";
  if (!etat.coches) return "Cochez au moins un modèle à générer.";
  return null;
}
