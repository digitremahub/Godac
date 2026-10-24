/**
 * Envoi d'une action sur un arrêt ou une tournée depuis le téléphone : direct,
 * sinon (pas de réseau) mis dans la file hors ligne (lib/offline/outbox.ts)
 * et rejoué au retour du réseau. Utilisé par les actions rapides de GO.
 */
import { api } from "@/components/colis/commun";
import { enqueueOfflineMutation, isNetworkFailure } from "@/lib/offline/outbox";

export type IssueEnvoi = "envoye" | "en_attente";

export async function envoyerOuMettreEnAttente(url: string, method: "PATCH" | "DELETE", corps?: unknown, keepalive = false): Promise<IssueEnvoi> {
  const body = corps === undefined ? undefined : JSON.stringify(corps);
  try {
    if (keepalive) {
      // Fermeture de l'écran : la requête doit survivre à la page.
      const res = await fetch(url, { method, body, keepalive: true, headers: body ? { "Content-Type": "application/json" } : undefined });
      if (!res.ok) throw new Error("Erreur réseau");
    } else await api(url, { method, body });
    return "envoye";
  } catch (e) {
    if (!isNetworkFailure(e)) throw e;
    await enqueueOfflineMutation(url, { method, body });
    return "en_attente";
  }
}

export const patchArret = (stopId: string, corps: unknown) => envoyerOuMettreEnAttente(`/api/colis/arrets/${stopId}`, "PATCH", corps);
export const retirerArret = (stopId: string, keepalive = false) => envoyerOuMettreEnAttente(`/api/colis/arrets/${stopId}`, "DELETE", undefined, keepalive);
export const patchTournee = (runId: string, corps: unknown) => envoyerOuMettreEnAttente(`/api/colis/tournees/${runId}`, "PATCH", corps);
