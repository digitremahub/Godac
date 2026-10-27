import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cookie de challenge WebAuthn signé : `challenge.expiration.signature`.
 * La signature (HMAC-SHA256, secret serveur) empêche de forger ou de modifier
 * le challenge côté navigateur ; l'expiration est dans la valeur signée, donc
 * non rallongeable. Fichier pur (secret et horloge en paramètres) : testé dans
 * lib/auth/__tests__/challenge-signe.test.ts.
 */
export const VALIDITE_CHALLENGE_S = 180;

function signature(secret: string, challenge: string, expiration: number): string {
  return createHmac("sha256", secret).update(`godac-webauthn-challenge:${challenge}.${expiration}`).digest("base64url");
}

/** Le challenge WebAuthn est en base64url : il ne contient jamais de point. */
export function signerChallenge(challenge: string, secret: string, maintenantMs: number = Date.now()): string {
  const expiration = Math.floor(maintenantMs / 1000) + VALIDITE_CHALLENGE_S;
  return `${challenge}.${expiration}.${signature(secret, challenge, expiration)}`;
}

/** Challenge si la valeur est authentique et non expirée, sinon null. */
export function lireChallengeSigne(valeur: string | undefined | null, secret: string, maintenantMs: number = Date.now()): string | null {
  if (!valeur) return null;
  const morceaux = valeur.split(".");
  if (morceaux.length !== 3) return null;
  const [challenge, expirationBrute, recue] = morceaux as [string, string, string];
  const expiration = Number(expirationBrute);
  if (!challenge || !Number.isInteger(expiration) || expiration < Math.floor(maintenantMs / 1000)) return null;
  const attendue = Buffer.from(signature(secret, challenge, expiration));
  const fournie = Buffer.from(recue);
  if (attendue.length !== fournie.length || !timingSafeEqual(attendue, fournie)) return null;
  return challenge;
}

/** Clé de comptage « usage unique » d'un challenge (empreinte, pas le challenge). */
export function cleUsageUnique(challenge: string): string {
  return `passkey-challenge:${createHmac("sha256", "godac-usage-unique").update(challenge).digest("hex").slice(0, 32)}`;
}
