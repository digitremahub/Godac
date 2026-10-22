"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/colis/commun";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { confirmer } from "@/lib/ui/confirmation";

/**
 * Suppression d'une tournée colis depuis l'historique, réservée à la
 * direction (y compris une tournée clôturée) : la suppression est
 * définitive et inscrite au journal d'audit.
 */
export function SupprimerTourneeDirection({ runId, nom, cloturee, retour }: { runId: string; nom: string; cloturee: boolean; retour: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function supprimer() {
    const texte = cloturee
      ? `La tournée colis clôturée « ${nom} » et tout son historique de livraison (preuves comprises) seront supprimés. L'action sera inscrite au journal d'audit.`
      : `La tournée colis « ${nom} » et ses arrêts seront supprimés.`;
    if (!(await confirmer({ titre: "Supprimer définitivement la tournée colis ?", message: texte, action: "Supprimer", danger: true }))) return;
    setBusy(true);
    setErreur(null);
    try {
      await api(`/api/colis/tournees/${runId}`, { method: "DELETE" });
      router.push(retour);
      router.refresh();
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" className="btn-ghost !py-1.5 text-sm text-orange-ink" disabled={busy} onClick={supprimer}>
        {busy ? "Suppression…" : "Supprimer (direction)"}
      </button>
      {erreur && <span role="alert" className="text-xs text-orange-ink">{erreur}</span>}
    </span>
  );
}
