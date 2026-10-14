import { createHash, randomBytes } from "node:crypto";

/**
 * Lien sécurisé du prestataire (/prestataire/[token]) : 32 octets
 * aléatoires encodés en base64url (43 caractères). Seul le SHA-256 est
 * stocké (rental_maintenance_requests.token_hash) ; le jeton en clair
 * n'existe que dans l'e-mail envoyé et dans la réponse de l'API au
 * responsable qui l'a généré. Un jeton = une seule demande.
 */
export const TOKEN_BYTES = 32;
export const TOKEN_VALIDITY_DAYS = 30;
/** Durée de validité des liens signés (photos) envoyés au prestataire. */
export const SIGNED_LINK_SECONDS = 7 * 24 * 3600;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateProviderToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Rejette tout ce qui n'a pas la forme d'un jeton avant même de toucher la base. */
export function looksLikeProviderToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export function hashProviderToken(token: string): string {
  return createHash("sha256").update(`godac-prestataire:${token}`).digest("hex");
}

export function tokenExpiry(now: Date = new Date(), days: number = TOKEN_VALIDITY_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 3600 * 1000);
}

export function isTokenUsable(expiresAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const t = typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt.getTime();
  return Number.isFinite(t) && t > now.getTime();
}

/** Adresse IP hachée pour la limitation de débit (jamais stockée en clair). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`godac-prestataire-ip:${ip}`).digest("hex").slice(0, 32);
}

/** Limites du lien public, par IP hachée. */
export const RATE_LIMITS = {
  /** Tentatives avec un jeton invalide ou expiré, sur 15 minutes. */
  echecs15min: 10,
  /** Actions (réponses, dépôts) sur une heure. */
  actionsHeure: 20,
  /** Consultations de la page sur une heure. */
  lecturesHeure: 120,
} as const;
