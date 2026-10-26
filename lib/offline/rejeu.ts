// Règles de rejeu de la file hors ligne (lib/offline/outbox.ts). Pures, testées.

export type DecisionRejeu = "reessayer" | "abandonner";

/**
 * Après une réponse en échec : une erreur 4xx est définitive (requête
 * refusée, ressource absente, conflit) et ne sera pas corrigée en
 * retentant, sauf 401 (session expirée, reconnexion attendue), 408 et 429.
 * Une coupure réseau ou une erreur serveur (5xx) n'abandonne jamais :
 * l'action reste en file, avec ses photos, jusqu'au retour du réseau ; le
 * dédoublonnage côté serveur (lib/offline/idempotence-serveur.ts) rend
 * chaque rejeu sans risque.
 */
export function decisionApresEchec(status: number | null): DecisionRejeu {
  if (status !== null && status >= 400 && status < 500 && ![401, 408, 429].includes(status)) return "abandonner";
  return "reessayer";
}

/** Une action n'est rejouée que sous le compte qui l'a enregistrée. */
export function rejouablePar(proprietaire: string | null | undefined, utilisateur: string | null): boolean {
  return Boolean(proprietaire) && Boolean(utilisateur) && proprietaire === utilisateur;
}
