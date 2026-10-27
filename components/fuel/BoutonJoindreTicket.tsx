"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconCamera } from "@/components/layout/icons";
import { joindreTicket } from "@/lib/fuel/ticket-client";

/**
 * « Joindre le ticket » sur une ligne de la liste des pleins : une seule
 * action (appareil photo ou galerie, au choix du téléphone) qui envoie la photo
 * et la rattache au plein. Résout le point bloquant TICPE « sans justificatif ».
 */
export function BoutonJoindreTicket({ entryId, remplacer = false }: { entryId: string; remplacer?: boolean }) {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "envoi" | "fait">("repos");
  const [erreur, setErreur] = useState<string | null>(null);

  async function envoyer(fichier: File | undefined) {
    if (!fichier) return;
    setEtat("envoi");
    setErreur(null);
    const r = await joindreTicket(entryId, fichier);
    if (!r.ok) {
      setEtat("repos");
      return setErreur(r.message);
    }
    setEtat("fait");
    router.refresh();
  }

  if (etat === "fait") return <span className="text-xs text-teal-ink">Ticket joint</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <label className="btn-secondary inline-flex min-h-[44px] cursor-pointer items-center justify-center !px-3 text-xs">
        <IconCamera className="mr-1 inline-block h-4 w-4 shrink-0" />
        {etat === "envoi" ? "Envoi…" : remplacer ? "Remplacer le ticket" : "Joindre le ticket"}
        <input type="file" accept="image/*" className="sr-only" disabled={etat === "envoi"} onChange={(e) => envoyer(e.target.files?.[0])} />
      </label>
      {erreur && (
        <span role="alert" className="max-w-[16rem] text-right text-xs text-orange-ink">
          {erreur}
        </span>
      )}
    </span>
  );
}
