/**
 * Réglages TICPE d'une organisation (table ticpe_settings, migration
 * 20261031000001). Pur : valeurs par défaut, normalisation d'une ligne
 * lue en base, schéma de validation du formulaire.
 */

import { z } from "zod";
import type { CategorieTicpe } from "@/lib/ticpe/bareme";

export const REGIMES_TVA = ["mensuel", "trimestriel", "annuel_ca12"] as const;
export type RegimeTva = (typeof REGIMES_TVA)[number];

export const LIBELLES_REGIME: Record<RegimeTva, string> = {
  mensuel: "Réel normal — CA3 mensuelle",
  trimestriel: "CA3 trimestrielle",
  annuel_ca12: "Réel simplifié — CA12 annuelle",
};

export interface ReglagesTicpe {
  activite_trm: boolean;
  activite_trv: boolean;
  activite_taxi: boolean;
  categorie_par_defaut: CategorieTicpe;
  regime_tva: RegimeTva;
  /** Jour du mois de la date limite de dépôt de la TVA ; null = fin du mois suivant. */
  jour_limite_depot: number | null;
  /** MM-JJ ; null = valeur par défaut (début mai, à confirmer). */
  date_limite_ca12: string | null;
  /** Plafond de volume appliqué seulement si l'organisation l'a activé ET saisi (base légale non confirmée). */
  plafond_actif: boolean;
  /** Litres par véhicule et par période ; null = aucune valeur saisie. Sans effet tant que plafond_actif est faux. */
  plafond_litres: number | null;
  plafond_periode: "annuel" | "semestriel";
  accepte_hvo_b100: boolean;
  location_demandeur: "nous" | "loueur";
  zone_par_defaut: "metropole" | "corse";
  forfait_pondere_2025: boolean;
  rappel_jours: number;
}

/** Modèle standard : TRM seul, CA3 mensuelle, aucun plafond de volume, gazole seul, location demandée par nous. */
export const REGLAGES_PAR_DEFAUT: ReglagesTicpe = {
  activite_trm: true,
  activite_trv: false,
  activite_taxi: false,
  categorie_par_defaut: "trm",
  regime_tva: "mensuel",
  jour_limite_depot: null,
  date_limite_ca12: null,
  plafond_actif: false,
  plafond_litres: null,
  plafond_periode: "annuel",
  accepte_hvo_b100: false,
  location_demandeur: "nous",
  zone_par_defaut: "metropole",
  forfait_pondere_2025: false,
  rappel_jours: 7,
};

export const schemaReglages = z
  .object({
    activite_trm: z.boolean(),
    activite_trv: z.boolean(),
    activite_taxi: z.boolean(),
    categorie_par_defaut: z.enum(["trm", "trv", "taxi"]),
    regime_tva: z.enum(REGIMES_TVA),
    jour_limite_depot: z.number().int().min(1).max(31).nullable(),
    date_limite_ca12: z
      .string()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, "Format MM-JJ attendu (ex. 05-05).")
      .nullable(),
    plafond_actif: z.boolean(),
    plafond_litres: z.number().int().positive().max(1_000_000).nullable(),
    plafond_periode: z.enum(["annuel", "semestriel"]),
    accepte_hvo_b100: z.boolean(),
    location_demandeur: z.enum(["nous", "loueur"]),
    zone_par_defaut: z.enum(["metropole", "corse"]),
    forfait_pondere_2025: z.boolean(),
    rappel_jours: z.number().int().min(0).max(60),
  })
  .refine((r) => !r.plafond_actif || r.plafond_litres !== null, { message: "Saisissez le plafond en litres pour l'activer.", path: ["plafond_litres"] })
  .refine((r) => r.activite_trm || r.activite_trv || r.activite_taxi, { message: "Cochez au moins une activité.", path: ["activite_trm"] })
  .refine((r) => (r.categorie_par_defaut === "trm" ? r.activite_trm : r.categorie_par_defaut === "trv" ? r.activite_trv : r.activite_taxi), {
    message: "La catégorie par défaut doit être une activité cochée.",
    path: ["categorie_par_defaut"],
  });

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
function un<T extends string>(v: unknown, valeurs: readonly T[], d: T): T {
  return typeof v === "string" && (valeurs as readonly string[]).includes(v) ? (v as T) : d;
}
function entier(v: unknown, d: number | null, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : d;
}

/** Ligne ticpe_settings (ou null : pas de ligne / table absente) → réglages complets. */
export function normaliserReglages(ligne: Record<string, unknown> | null | undefined): ReglagesTicpe {
  const d = REGLAGES_PAR_DEFAUT;
  if (!ligne) return { ...d };
  const r: ReglagesTicpe = {
    activite_trm: bool(ligne.activite_trm, d.activite_trm),
    activite_trv: bool(ligne.activite_trv, d.activite_trv),
    activite_taxi: bool(ligne.activite_taxi, d.activite_taxi),
    categorie_par_defaut: un(ligne.categorie_par_defaut, ["trm", "trv", "taxi"] as const, d.categorie_par_defaut),
    regime_tva: un(ligne.regime_tva, REGIMES_TVA, d.regime_tva),
    jour_limite_depot: entier(ligne.jour_limite_depot, null, 1, 31),
    date_limite_ca12: typeof ligne.date_limite_ca12 === "string" && /^\d{2}-\d{2}$/.test(ligne.date_limite_ca12) ? ligne.date_limite_ca12 : null,
    plafond_actif: false,
    plafond_litres: entier(ligne.plafond_litres, null, 1, 1_000_000),
    plafond_periode: un(ligne.plafond_periode, ["annuel", "semestriel"] as const, d.plafond_periode),
    accepte_hvo_b100: bool(ligne.accepte_hvo_b100, d.accepte_hvo_b100),
    location_demandeur: un(ligne.location_demandeur, ["nous", "loueur"] as const, d.location_demandeur),
    zone_par_defaut: un(ligne.zone_par_defaut, ["metropole", "corse"] as const, d.zone_par_defaut),
    forfait_pondere_2025: bool(ligne.forfait_pondere_2025, d.forfait_pondere_2025),
    rappel_jours: entier(ligne.rappel_jours, d.rappel_jours, 0, 60) ?? d.rappel_jours,
  };
  // Colonne absente (migration non appliquée) ou non cochée : aucun plafond.
  r.plafond_actif = bool(ligne.plafond_actif, false) && r.plafond_litres !== null;
  if (!r.activite_trm && !r.activite_trv && !r.activite_taxi) r.activite_trm = true;
  return r;
}

/** Plafond réellement appliqué : null (aucun) tant que l'organisation ne l'a pas activé et saisi. */
export function plafondEffectif(reglages: Pick<ReglagesTicpe, "plafond_actif" | "plafond_litres">): number | null {
  return reglages.plafond_actif && reglages.plafond_litres !== null && reglages.plafond_litres > 0 ? reglages.plafond_litres : null;
}

/** Mention obligatoire autour de tout plafond de volume. */
export const MENTION_PLAFOND = `Plafond de volume : ${"à confirmer par l'expert-comptable"} — base légale non confirmée.`;

/** Activité cochée dans les réglages ? */
export function activiteActive(reglages: ReglagesTicpe, categorie: CategorieTicpe): boolean {
  return categorie === "trm" ? reglages.activite_trm : categorie === "trv" ? reglages.activite_trv : reglages.activite_taxi;
}

/** Avertissement à afficher partout. */
export const AVERTISSEMENT_TICPE = "GODAC prépare les montants ; la déclaration reste faite par l'entreprise ou son expert-comptable.";
export const MENTION_A_CONFIRMER = "à confirmer par l'expert-comptable";
