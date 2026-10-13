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
});

export const profilSchema = z.object({
  regime: z.enum(["grand_routier", "courte_distance", "sedentaire"]),
  is_cadre: z.boolean(),
  coefficient: z.string().trim().max(20).nullable(),
  hourly_rate: z.coerce.number().positive().max(1000),
  contractual_hours: z.coerce.number().positive().max(300),
  pas_rate: taux.nullable(),
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
      }),
    )
    .max(20)
    .default([]),
  personnesACharge: z.coerce.number().int().min(0).max(20).default(0),
});
