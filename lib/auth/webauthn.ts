import "server-only";
import { choisirRp } from "@/lib/auth/passkey-erreurs";
import { cleUsageUnique, lireChallengeSigne, signerChallenge, VALIDITE_CHALLENGE_S } from "@/lib/auth/challenge-signe";
import { consommerLimite } from "@/lib/http/limiteur-serveur";

/**
 * Shared WebAuthn (Face ID / empreinte) config. rpID is the bare
 * hostname (no protocol/port); a credential registered under one rpID
 * can never be used to authenticate against another, which is why it
 * tracks NEXT_PUBLIC_APP_URL. When the request comes from another
 * allowed origin (WEBAUTHN_EXTRA_ORIGINS, comma separated), that
 * origin is used instead so the browser never raises a SecurityError;
 * verification accepts every allowed origin / rpID.
 */
export function webauthnConfig(origineRequete?: string | null) {
  const rp = choisirRp({
    urlApp: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    extra: process.env.WEBAUTHN_EXTRA_ORIGINS ?? null,
    origineRequete,
  });
  return { rpName: "GODAC", ...rp };
}

export const WEBAUTHN_CHALLENGE_COOKIE = "webauthn_challenge";

/** Options du cookie de challenge : httpOnly, 2 min, Secure en https seulement (localhost en http). */
export function optionsCookieChallenge(origin: string) {
  return {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "lax" as const,
    maxAge: VALIDITE_CHALLENGE_S,
    path: "/",
  };
}

function secretChallenge(): string {
  const s = process.env.PIN_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("PIN_PEPPER is not configured");
  return s;
}

/** Valeur du cookie de challenge : signée, avec expiration (lib/auth/challenge-signe.ts). */
export function cookieChallengeSigne(challenge: string): string {
  return signerChallenge(challenge, secretChallenge());
}

/**
 * Challenge attendu, lu et consommé : le cookie est supprimé quoi qu'il
 * arrive ensuite (un essai raté oblige à redemander des options) et un même
 * challenge ne sert qu'une fois (compteur atomique, repli en mémoire).
 */
export async function consommerChallenge(
  cookieStore: { get(nom: string): { value: string } | undefined; delete(nom: string): unknown },
): Promise<string | null> {
  const brut = cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE)?.value;
  cookieStore.delete(WEBAUTHN_CHALLENGE_COOKIE);
  const challenge = lireChallengeSigne(brut, secretChallenge());
  if (!challenge) return null;
  const decision = await consommerLimite(cleUsageUnique(challenge), { nom: "passkey-challenge", max: 1, fenetreS: VALIDITE_CHALLENGE_S });
  return decision.autorise ? challenge : null;
}
