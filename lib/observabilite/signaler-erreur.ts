import { assainirChemin, assainirTexte, type OrigineErreur } from "@/lib/observabilite/erreurs-client";

const dejaSignalees = new Set<string>();

/**
 * Envoie l'erreur d'affichage au serveur (journal borné, sans donnée
 * personnelle), une seule fois par message dans la session. Ne lève jamais :
 * un échec du signalement ne doit pas aggraver l'erreur.
 */
export function signalerErreur(origine: OrigineErreur, error: Error & { digest?: string }): void {
  try {
    const message = assainirTexte(error.message || String(error));
    const cle = `${origine}:${error.digest ?? message}`;
    if (!message || dejaSignalees.has(cle)) return;
    dejaSignalees.add(cle);
    const corps = JSON.stringify({ origine, message, digest: error.digest ?? null, chemin: assainirChemin(window.location.pathname) });
    if (navigator.sendBeacon?.("/api/client-errors", new Blob([corps], { type: "application/json" }))) return;
    void fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: corps, keepalive: true }).catch(() => undefined);
  } catch {
    /* signalement impossible : sans conséquence */
  }
}
