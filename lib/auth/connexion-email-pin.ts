// Connexion chauffeur par e-mail + PIN (app/api/auth/driver-pin/login).
// Fonctions pures, testées dans lib/auth/__tests__/connexion-email-pin.test.ts.
import { z } from "zod";

export const connexionEmailPinSchema = z.object({
  email: z.string().trim().email().max(254),
  // Audit E6 : `/^\\d{4,32}$/` cherchait un antislash littéral, aucun PIN ne passait.
  pin: z.string().regex(/^\d{4,32}$/),
});

export interface CompteCandidat {
  id: string;
  email: string;
  contact_email: string | null;
  organization_id: string;
  full_name: string;
  auth_method: string;
  pin_set_at: string | null;
  active: boolean;
  pending_approval: boolean;
}

/** Échappe `%`, `_` et `\` pour un filtre `ilike` qui doit être une égalité exacte. */
export function motifIlikeExact(valeur: string): string {
  return valeur.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type ChoixCompte = { ok: true; compte: CompteCandidat } | { ok: false; raison: "introuvable" | "ambigu" };

/**
 * L'e-mail d'authentification d'un chauffeur PIN est interne
 * (`chauffeur-<uuid>@<org>.godac.local`) : le chauffeur saisit son e-mail
 * de contact. Un compte n'est retenu que s'il est seul à porter cette
 * adresse (e-mail de connexion ou de contact) parmi les comptes PIN ;
 * sinon le chauffeur doit passer par son badge.
 */
export function choisirCompte(candidats: CompteCandidat[], email: string): ChoixCompte {
  const cible = email.trim().toLowerCase();
  const pin = candidats.filter(
    (c) => c.auth_method === "pin" && (c.email.toLowerCase() === cible || (c.contact_email ?? "").trim().toLowerCase() === cible),
  );
  const uniques = [...new Map(pin.map((c) => [c.id, c])).values()];
  if (uniques.length === 0) return { ok: false, raison: "introuvable" };
  if (uniques.length > 1) return { ok: false, raison: "ambigu" };
  return { ok: true, compte: uniques[0]! };
}
