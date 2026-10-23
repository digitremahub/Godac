import { z } from "zod";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { nettoyerNomEntreprise } from "@/lib/recommandation/entreprise";

/** Limite anti-abus : recommandations par utilisateur et par jour. */
export const MAX_RECOMMANDATIONS_PAR_JOUR = 5;

const texteFacultatif = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/**
 * Formulaire « Recommander GODAC à mon employeur ». Au moins un moyen de
 * contact (e-mail ou téléphone) ; le consentement doit être explicitement
 * coché (true), jamais présumé.
 */
export const recommandationSchema = z
  .object({
    companyName: z
      .string()
      .transform(nettoyerNomEntreprise)
      .pipe(z.string().min(2, "Indiquez le nom de l'entreprise (2 caractères minimum).").max(120, "Nom d'entreprise : 120 caractères maximum.")),
    contactName: texteFacultatif(120),
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.string().email("Adresse e-mail invalide.").nullable()),
    contactPhone: z
      .string()
      .trim()
      .max(30)
      .optional()
      .transform((v) => (v ? v : null)),
    message: texteFacultatif(500),
    consent: z.literal(true, { errorMap: () => ({ message: "Cochez la case pour autoriser GODAC à contacter votre employeur." }) }),
  })
  .superRefine((d, ctx) => {
    if (d.contactPhone && !normaliserTelephone(d.contactPhone)) {
      ctx.addIssue({ code: "custom", path: ["contactPhone"], message: "Numéro de téléphone invalide." });
    }
    if (!d.contactEmail && !d.contactPhone) {
      ctx.addIssue({ code: "custom", path: ["contactEmail"], message: "Indiquez un e-mail ou un téléphone pour joindre l'entreprise." });
    }
  })
  .transform((d) => ({ ...d, contactPhone: d.contactPhone ? normaliserTelephone(d.contactPhone) : null }));

export type RecommandationSaisie = z.output<typeof recommandationSchema>;
