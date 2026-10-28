import { z } from "zod";

/**
 * Attributs génériques et facultatifs d'une unité de stock (fichier pur, testé dans
 * lib/stock/__tests__/attributs.test.ts) : nature, température, fragile, urgent,
 * consigne imprimée sur l'étiquette, référence client / bordereau, lot, DLC,
 * température relevée. Aucune logique réglementaire : GODAC fournit un suivi
 * logistique ; le respect des exigences propres au secteur (chaîne du froid,
 * traçabilité sanitaire, pharmacie, sang) reste à la charge de l'entreprise.
 */

export const NATURES = ["colis", "palette", "prelevement", "medicament", "alimentaire", "pharmaceutique", "autre"] as const;
export type Nature = (typeof NATURES)[number];
export const LIBELLES_NATURE: Record<Nature, string> = {
  colis: "Colis",
  palette: "Palette",
  prelevement: "Prélèvement / échantillon biologique",
  medicament: "Médicament",
  alimentaire: "Produit alimentaire",
  pharmaceutique: "Produit pharmaceutique",
  autre: "Autre",
};
/** Libellé court pour l'étiquette. */
export const LIBELLES_NATURE_COURTS: Record<Nature, string> = {
  colis: "Colis",
  palette: "Palette",
  prelevement: "Prélèvement",
  medicament: "Médicament",
  alimentaire: "Alimentaire",
  pharmaceutique: "Pharmaceutique",
  autre: "Autre",
};

export const TEMPERATURES = ["ambiante", "frais", "congele", "autre"] as const;
export type Temperature = (typeof TEMPERATURES)[number];
export const LIBELLES_TEMPERATURE: Record<Temperature, string> = {
  ambiante: "Ambiante",
  frais: "Frais (2 à 8 °C)",
  congele: "Congelé",
  autre: "Autre",
};
export const LIBELLES_TEMPERATURE_COURTS: Record<Temperature, string> = {
  ambiante: "Ambiante",
  frais: "2-8 °C",
  congele: "Congelé",
  autre: "Temp. autre",
};

export const LIBELLE_LIBRE_MAX = 60;
export const CONSIGNE_MAX = 120;
export const REFERENCE_CLIENT_MAX = 60;
export const LOT_UNITE_MAX = 60;
export const TEMPERATURE_RELEVEE_MIN = -100;
export const TEMPERATURE_RELEVEE_MAX = 100;

export const AVERTISSEMENT_DONNEES_SANTE = "Ne saisissez aucune donnée de santé nominative (nom, prénom, identité d'un patient ou d'un donneur) : les champs libres sont destinés à la logistique seulement.";
export const MENTION_SUIVI_LOGISTIQUE =
  "GODAC fournit un suivi logistique configurable. Le respect des exigences réglementaires propres à votre secteur (chaîne du froid, traçabilité sanitaire, pharmacie, produits sanguins, bonnes pratiques de distribution) reste à la charge de l'entreprise : GODAC ne garantit aucune conformité réglementaire.";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Attributs reçus d'un écran (chaque champ est facultatif ; null = effacer). */
export const schemaAttributs = z
  .object({
    nature: z.enum(NATURES).nullable().optional(),
    nature_libelle: z.string().trim().max(LIBELLE_LIBRE_MAX).nullable().optional(),
    temperature: z.enum(TEMPERATURES).nullable().optional(),
    temperature_libelle: z.string().trim().max(LIBELLE_LIBRE_MAX).nullable().optional(),
    temperature_releve: z.number().min(TEMPERATURE_RELEVEE_MIN).max(TEMPERATURE_RELEVEE_MAX).nullable().optional(),
    fragile: z.boolean().optional(),
    urgent: z.boolean().optional(),
    consigne: z.string().trim().max(CONSIGNE_MAX).nullable().optional(),
    reference_client: z.string().trim().max(REFERENCE_CLIENT_MAX).nullable().optional(),
    lot: z.string().trim().max(LOT_UNITE_MAX).nullable().optional(),
    dlc: date.nullable().optional(),
  })
  .strict();
export type AttributsUnite = z.infer<typeof schemaAttributs>;

/** Valeurs lues en base pour une unité. */
export interface AttributsLus {
  nature: Nature | null;
  nature_libelle: string | null;
  temperature: Temperature | null;
  temperature_libelle: string | null;
  temperature_releve: number | null;
  fragile: boolean;
  urgent: boolean;
  consigne: string | null;
  reference_client: string | null;
  lot: string | null;
  dlc: string | null;
}

export const COLONNES_ATTRIBUTS = "nature, nature_libelle, temperature, temperature_libelle, temperature_releve, fragile, urgent, consigne, reference_client, lot, dlc";

export function libelleNature(n: Nature | null | undefined, libre?: string | null, court = false): string {
  if (!n) return "";
  if (n === "autre" && libre?.trim()) return libre.trim();
  return (court ? LIBELLES_NATURE_COURTS : LIBELLES_NATURE)[n];
}

export function libelleTemperature(t: Temperature | null | undefined, libre?: string | null, court = false): string {
  if (!t) return "";
  if (t === "autre" && libre?.trim()) return libre.trim();
  return (court ? LIBELLES_TEMPERATURE_COURTS : LIBELLES_TEMPERATURE)[t];
}

/** Ligne de synthèse lisible (fiche d'unité, recherche) : « Prélèvement · 2-8 °C · fragile · urgent ». */
export function resumeAttributs(a: Partial<AttributsLus> | null | undefined): string {
  if (!a) return "";
  return [libelleNature(a.nature ?? null, a.nature_libelle, true), libelleTemperature(a.temperature ?? null, a.temperature_libelle, true), a.fragile ? "fragile" : "", a.urgent ? "urgent" : ""].filter(Boolean).join(" · ");
}

/**
 * Attributs nettoyés pour la fonction SQL : seules les clés présentes sont gardées,
 * chaînes vides = effacer (null), « nature_libelle » ignoré hors nature « autre »
 * (idem température). Renvoie null s'il n'y a rien à envoyer.
 */
export function attributsPourRpc(a: AttributsUnite | null | undefined): Record<string, unknown> | null {
  if (!a) return null;
  const sortie: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined) continue;
    sortie[k] = typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v;
  }
  if ("nature_libelle" in sortie && "nature" in sortie && sortie.nature !== "autre") sortie.nature_libelle = null;
  if ("temperature_libelle" in sortie && "temperature" in sortie && sortie.temperature !== "autre") sortie.temperature_libelle = null;
  return Object.keys(sortie).length ? sortie : null;
}
