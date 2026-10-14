import { z } from "zod";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const providerSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(160),
  kind: z.enum(["loueur", "garage", "loueur_entretien"]).default("loueur"),
  contact_name: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()).optional(),
  maintenance_emails: z.array(z.string().trim().toLowerCase().email("Adresse e-mail invalide.")).max(5).default([]),
  phone: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()).optional(),
  contract_reference: z.preprocess(emptyToNull, z.string().trim().max(120).nullable()).optional(),
  notes: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable()).optional(),
  active: z.boolean().optional(),
});

/** « a@b.fr; c@d.fr » ou retours à la ligne → liste dédoublonnée. */
export function parseEmailList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}
