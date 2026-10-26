"use client";
import { useEffect } from "react";
import { flushOfflineMutations, listOfflineMutations, OFFLINE_QUEUE_EVENT } from "@/lib/offline/outbox";

/**
 * Vidage silencieux de la file hors ligne pour les écrans plein écran du
 * conducteur (/livreur, GO Navigation), où le bandeau OfflineSyncStatus du
 * tableau de bord n'est pas monté : retour du réseau, nouvelle action en
 * attente, et reprise toutes les 15 s tant que la file n'est pas vide.
 */
export function SynchroHorsLigne() {
  useEffect(() => {
    let enCours = false;
    const vider = async () => {
      if (enCours || !navigator.onLine) return;
      enCours = true;
      try {
        const result = await flushOfflineMutations();
        if (result.synced > 0 && result.pending === 0) window.dispatchEvent(new Event("godac:offline-synced"));
      } catch {
        // Stockage hors ligne indisponible : rien à vider.
      } finally {
        enCours = false;
      }
    };
    const siEnAttente = async () => {
      try {
        if ((await listOfflineMutations()).length > 0) await vider();
      } catch {
        // idem
      }
    };
    void siEnAttente();
    const auRetourDuReseau = () => { void vider(); };
    const auChangement = () => { void siEnAttente(); };
    window.addEventListener("online", auRetourDuReseau);
    window.addEventListener(OFFLINE_QUEUE_EVENT, auChangement);
    const interval = window.setInterval(() => { void siEnAttente(); }, 15000);
    return () => {
      window.removeEventListener("online", auRetourDuReseau);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, auChangement);
      window.clearInterval(interval);
    };
  }, []);
  return null;
}
