import "server-only";

/**
 * Shared WebAuthn (Face ID / empreinte) config — one rpID/origin pair
 * for every registration and authentication call, server-wide. rpID
 * is the bare hostname (no protocol/port); a credential registered
 * under one rpID can never be used to authenticate against another,
 * which is exactly why this can't just be hardcoded per-environment
 * and must track NEXT_PUBLIC_APP_URL.
 */
export function webauthnConfig() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const parsedUrl = new URL(configuredUrl);
  const origin = parsedUrl.origin;
  const rpID = parsedUrl.hostname;
  return { rpName: "GODAC", rpID, origin };
}

export const WEBAUTHN_CHALLENGE_COOKIE = "webauthn_challenge";
