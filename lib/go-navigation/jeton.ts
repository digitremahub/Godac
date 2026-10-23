import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Jeton du lien d'invitation GO Navigation (/go-navigation/[jeton]) : même
 * procédé que le lien prestataire (lib/rental/token.ts) — 32 octets
 * aléatoires en base64url (43 caractères), seul le SHA-256 salé par un
 * préfixe propre à l'usage est stocké. Le jeton en clair n'existe que dans
 * la réponse de création, affichée une fois au staff.
 */
const JETON_OCTETS = 32;
const FORME_JETON = /^[A-Za-z0-9_-]{43}$/;

export function genererJetonInvitation(): string {
  return randomBytes(JETON_OCTETS).toString("base64url");
}

/** Rejette tout ce qui n'a pas la forme d'un jeton avant même de toucher la base. */
export function ressembleJetonInvitation(jeton: unknown): jeton is string {
  return typeof jeton === "string" && FORME_JETON.test(jeton);
}

export function hacherJetonInvitation(jeton: string): string {
  return createHash("sha256").update(`godac-go-navigation:${jeton}`).digest("hex");
}

/**
 * Jeton du lien PERSONNEL d'un apporteur (« Faire essayer GO ») : dérivé de
 * l'id du lien par HMAC-SHA256 (32 octets → 43 caractères, même forme que les
 * autres jetons). Seul le hash est stocké pour la recherche, mais le
 * propriétaire doit pouvoir revoir et recopier son lien : le serveur le
 * recalcule depuis l'id. Changer le secret invalide les liens existants
 * (il suffit de les régénérer).
 */
export function deriverJetonApporteur(lienId: string, secret: string): string {
  return createHmac("sha256", secret).update(`godac-apporteur-go:${lienId}`).digest("base64url");
}

/** Adresse IP hachée pour la limitation de débit (jamais stockée en clair). */
export function hacherIpInscription(ip: string): string {
  return createHash("sha256").update(`godac-go-navigation-ip:${ip}`).digest("hex").slice(0, 32);
}

/** Limites de la page publique, par IP hachée. */
export const LIMITES_INSCRIPTION = {
  /** Jetons invalides / expirés / déjà utilisés, sur 15 minutes. */
  echecs15min: 10,
  /** Tentatives d'inscription (envois du formulaire) par heure. */
  tentativesHeure: 8,
} as const;
