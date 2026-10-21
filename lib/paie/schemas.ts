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
  // Maintien de salaire et subrogation (migration 20261026000002) : facultatifs.
  sick_pay_min_seniority_months: z.coerce.number().int().min(0).max(120).nullable().optional(),
  sick_pay_waiting_days: z.coerce.number().int().min(0).max(30).nullable().optional(),
  sick_pay_waiting_days_at: z.coerce.number().int().min(0).max(30).nullable().optional(),
  sick_pay_rate_1: taux.nullable().optional(),
  sick_pay_rate_2: taux.nullable().optional(),
  sick_pay_base_days: z.coerce.number().int().min(0).max(365).nullable().optional(),
  sick_pay_step_days: z.coerce.number().int().min(0).max(365).nullable().optional(),
  sick_pay_step_years: z.coerce.number().int().min(1).max(50).nullable().optional(),
  sick_pay_max_days: z.coerce.number().int().min(0).max(365).nullable().optional(),
  subrogation_enabled: z.boolean().optional(),
});

/** Colonnes ajoutées par 20261026000002 (maintien de salaire, subrogation). */
export const COLONNES_ARRETS_SORTIES = {
  reglages: [
    "sick_pay_min_seniority_months",
    "sick_pay_waiting_days",
    "sick_pay_waiting_days_at",
    "sick_pay_rate_1",
    "sick_pay_rate_2",
    "sick_pay_base_days",
    "sick_pay_step_days",
    "sick_pay_step_years",
    "sick_pay_max_days",
    "subrogation_enabled",
  ],
} as const;

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const arretSchema = z
  .object({
    id: z.string().uuid().optional(),
    type: z.enum(["maladie", "at_mp", "trajet", "maternite", "paternite", "sans_solde"]),
    du: dateIso,
    au: dateIso,
    prolongationDu: dateIso.nullable().optional(),
    ijssBrutesJour: z.coerce.number().min(0).max(1000).nullable().optional(),
    ijssNettesJour: z.coerce.number().min(0).max(1000).nullable().optional(),
    joursIjss: z.coerce.number().min(0).max(31).nullable().optional(),
    maintienManuel: z.coerce.number().min(0).max(100000).nullable().optional(),
  })
  .refine((a) => a.au >= a.du, { message: "Fin avant le début." });

export const sortieSchema = z.object({
  exit_date: dateIso,
  reason: z.enum(["licenciement", "licenciement_faute_grave", "rupture_conventionnelle", "demission", "fin_cdd", "retraite", "autre"]),
  notice_type: z.enum(["effectue", "paye", "non_paye", "sans"]),
  notice_days: z.coerce.number().min(0).max(365).nullable(),
  notice_amount: montant.nullable(),
  severance_amount: z.coerce.number().min(0).max(10000000).nullable(),
  jobs_held: z.string().trim().max(1000).nullable(),
  notes: z.string().trim().max(1000).nullable(),
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
  // Arrêts de travail (cumuls de référence CP et sortie : relus côté serveur).
  arrets: z.array(arretSchema).max(10).optional(),
  subrogation: z.boolean().nullable().optional(),
});
