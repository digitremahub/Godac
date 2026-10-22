import { z } from "zod";
import { CATEGORIES_TICPE, ZONES_TICPE } from "@/lib/ticpe/bareme";

/** Ligne du barème saisie par le staff GODAC (backoffice). Pur. */
export const schemaLigneBareme = z
  .object({
    categorie: z.enum(CATEGORIES_TICPE),
    zone: z.enum(ZONES_TICPE),
    date_debut: z.string().date(),
    date_fin: z.string().date().nullable(),
    taux_eur_hl: z.number().min(0).max(1000).nullable(),
    source: z.string().trim().max(500).nullable(),
    source_url: z.string().trim().url("Adresse de la source invalide.").max(1000).nullable(),
    verifie_le: z.string().date().nullable(),
    a_confirmer: z.boolean(),
    note: z.string().trim().max(1000).nullable(),
  })
  .refine((l) => !l.date_fin || l.date_fin >= l.date_debut, { message: "La fin précède le début.", path: ["date_fin"] });
