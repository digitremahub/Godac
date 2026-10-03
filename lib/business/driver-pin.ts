/**
 * PIN format rules for the QR-badge driver login (Lot 7). A PIN
 * replaces a password for an account that otherwise has no email the
 * driver can receive anything on, so it's worth rejecting the most
 * obviously guessable choices even though it can never be as strong
 * as a real password — Supabase Auth's own per-account rate limiting
 * on signInWithPassword is the main defense against brute-forcing it.
 */

export interface PinValidation {
  ok: boolean;
  message: string | null;
}

const SEQUENTIAL_ASCENDING = "0123456789";
const SEQUENTIAL_DESCENDING = "9876543210";

export function validatePin(pin: string): PinValidation {
  if (!/^\d{4,6}$/.test(pin)) {
    return { ok: false, message: "Le code PIN doit comporter entre 4 et 6 chiffres." };
  }
  if (new Set(pin).size === 1) {
    return { ok: false, message: "Ce code PIN est trop simple (chiffres identiques)." };
  }
  if (SEQUENTIAL_ASCENDING.includes(pin) || SEQUENTIAL_DESCENDING.includes(pin)) {
    return { ok: false, message: "Ce code PIN est trop simple (suite de chiffres)." };
  }
  return { ok: true, message: null };
}
