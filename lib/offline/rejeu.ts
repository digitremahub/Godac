// Règles de rejeu de la file hors ligne (lib/offline/outbox.ts). Pures, testées.

/** Au-delà, l'action est abandonnée (et signalée) au lieu d'être retentée sans fin. */
export const ESSAIS_MAX = 5;

export type DecisionRejeu = "reessayer" | "abandonner";

/**
 * Après une réponse en échec : une erreur 4xx est définitive (requête
 * refusée, ressource absente, conflit) et ne sera pas corrigée en
 * retentant, sauf 401 (session expirée, reconnexion attendue), 408 et 429.
 * Une erreur serveur ou réseau est retentée jusqu'à ESSAIS_MAX essais.
 */
export function decisionApresEchec(status: number | null, essais: number): DecisionRejeu {
  if (status !== null && status >= 400 && status < 500 && ![401, 408, 429].includes(status)) return "abandonner";
  return essais >= ESSAIS_MAX ? "abandonner" : "reessayer";
}

/** Une action n'est rejouée que sous le compte qui l'a enregistrée. */
export function rejouablePar(proprietaire: string | null | undefined, utilisateur: string | null): boolean {
  return Boolean(proprietaire) && Boolean(utilisateur) && proprietaire === utilisateur;
}
