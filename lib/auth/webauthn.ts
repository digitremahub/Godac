import "server-only";
import { choisirRp } from "@/lib/auth/passkey-erreurs";

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
    maxAge: 180,
    path: "/",
  };
}
