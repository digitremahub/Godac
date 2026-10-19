// Code d'activation remis par l'encadrement après une réinitialisation du
// PIN : sans lui, connaître l'identifiant du badge (QR) ne suffit plus à
// choisir un nouveau PIN. Fonctions pures (testées) ; la partie serveur
// est dans lib/auth/code-activation-serveur.ts.
import { randomInt } from "node:crypto";

/** Alphabet sans caractères ambigus (0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DUREE_ACTIVATION_JOURS = 7;
export const ESSAIS_ACTIVATION_MAX = 5;

/** « ABCD-EFGH » : 8 caractères, ~40 bits, usage unique et limité en essais. */
export function genererCodeActivation(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normaliserCodeActivation(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type EtatActivation =
  | { ok: true }
  | { ok: false; raison: "absent" | "expire" | "bloque" | "incorrect" };

/** Décide si un code saisi ouvre la création du PIN. `correspond` : comparaison du haché. */
export function evaluerActivation(
  activation: { expires_at: string; failed_count: number } | null,
  codeSaisi: string | undefined,
  correspond: (code: string) => boolean,
  maintenant = new Date(),
): EtatActivation {
  if (!activation) return { ok: true };
  if (Date.parse(activation.expires_at) <= maintenant.getTime()) return { ok: false, raison: "expire" };
  if (activation.failed_count >= ESSAIS_ACTIVATION_MAX) return { ok: false, raison: "bloque" };
  if (!codeSaisi || !normaliserCodeActivation(codeSaisi)) return { ok: false, raison: "absent" };
  return correspond(codeSaisi) ? { ok: true } : { ok: false, raison: "incorrect" };
}

export const MESSAGES_ACTIVATION: Record<Exclude<EtatActivation, { ok: true }>["raison"], string> = {
  absent: "Votre accès a été réinitialisé : saisissez le code d'activation remis par votre responsable.",
  expire: "Ce code d'activation a expiré. Demandez-en un nouveau à votre responsable.",
  bloque: "Trop d'essais avec ce code d'activation. Demandez-en un nouveau à votre responsable.",
  incorrect: "Code d'activation incorrect.",
};
