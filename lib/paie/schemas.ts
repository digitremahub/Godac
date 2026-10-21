import { z } from "zod";

const montant = z.coerce.number().min(0).max(100000);
const taux = z.coerce.number().min(0).max(100);

export const parametresEntrepriseSchema = z.object({
  headcount: z.coerce.number().int().min(1).max(100000),
  accident_rate: taux,
  mobility_rate: taux,
  prevoyance_salarial_rate: taux,
  prevoyance_patronal_rate: taux,
  mutuelle_salarial_amount: montant,
  mutuelle_patronal_amount: montant,
  meal_allowance: montant.nullable(),
  single_meal_allowance: montant.nullable(),
  snack_allowance: montant.nullable(),
  overnight_allowance: montant.nullable(),
  // Modèle transport (migration 20261024000003) : facultatifs.
  ccn_salarial_rate: taux.nullable().optional(),
  ccn_patronal_rate: taux.nullable().optional(),
  health_pmss_salarial_rate: taux.nullable().optional(),
  health_pmss_patronal_rate: taux.nullable().optional(),
  dfs_enabled: z.boolean().optional(),
  dfs_rate: taux.nullable().optional(),
});

/** Colonnes ajoutées par 20261024000003 : retirées si la migration n'est pas encore passée. */
export const COLONNES_MODELE_TRANSPORT = {
  reglages: ["ccn_salarial_rate", "ccn_patronal_rate", "health_pmss_salarial_rate", "health_pmss_patronal_rate", "dfs_enabled", "dfs_rate"],
  profil: ["job_group", "meal_rate", "leave_balance_n1", "leave_balance_n", "leave_balance_date"],
} as const;

export const profilSchema = z.object({
  regime: z.enum(["grand_routier", "courte_distance", "sedentaire"]),
  is_cadre: z.boolean(),
  coefficient: z.string().trim().max(20).nullable(),
  hourly_rate: z.coerce.number().positive().max(1000),
  contractual_hours: z.coerce.number().positive().max(300),
  pas_rate: taux.nullable(),
  // Modèle transport (migration 20261024000003) : facultatifs.
  job_group: z.string().trim().max(20).nullable().optional(),
  meal_rate: montant.nullable().optional(),
  leave_balance_n1: z.coerce.number().min(0).max(100).nullable().optional(),
  leave_balance_n: z.coerce.number().min(0).max(100).nullable().optional(),
  leave_balance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const variablesSchema = z.object({
  heuresTravaillees: z.coerce.number().min(0).max(400).nullable(),
  heuresAbsenceNonPayee: z.coerce.number().min(0).max(400),
  joursCongesPris: z.coerce.number().min(0).max(31),
  primes: z.array(z.object({ libelle: z.string().trim().max(80), montant: z.coerce.number().min(-100000).max(100000), soumise: z.boolean() })).max(20),
  nbRepas: z.coerce.number().int().min(0).max(62),
  nbRepasUnique: z.coerce.number().int().min(0).max(62),
  nbCasseCroute: z.coerce.number().int().min(0).max(62),
  nbGrandDeplacement: z.coerce.number().int().min(0).max(31),
  retenues: z
    .array(
      z.object({
        type: z.enum(["acompte", "saisie", "atd", "pension", "pret", "autre"]),
        libelle: z.string().trim().max(80),
        montant: z.coerce.number().min(0).max(100000),
        reference: z.string().trim().max(60).optional(),
        // Lignes d'acompte automatiques : écartées et relues en base par l'API.
        demandeId: z.string().uuid().optional(),
      }),
    )
    .max(20)
    .default([]),
  personnesACharge: z.coerce.number().int().min(0).max(20).default(0),
  heuresSup25: z.coerce.number().min(0).max(200).nullable().optional(),
  heuresSup50: z.coerce.number().min(0).max(200).nullable().optional(),
  periodesConges: z
    .array(z.object({ du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), jours: z.coerce.number().min(0).max(31) }))
    .max(10)
    .optional(),
  tauxRepas: z.coerce.number().min(0).max(100).nullable().optional(),
  // Date et mode de paiement (défaut : dernier jour du mois, virement).
  datePaiement: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  modePaiement: z.enum(["virement", "cheque", "especes"]).nullable().optional(),
  typeTauxPas: z.enum(["personnalise", "non_personnalise"]).nullable().optional(),
});
