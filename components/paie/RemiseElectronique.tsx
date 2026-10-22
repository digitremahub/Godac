"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { DUREE_LEGALE_DISPONIBILITE, INFORMATION_REMISE, libelleEtat, type EtatRemise } from "@/lib/paie/remise-electronique";
import { confirmer } from "@/lib/ui/confirmation";

/**
 * Mon espace › Mes fiches de paie : information sur la remise
 * électronique et opposition du salarié (art. L3243-2), choix daté.
 */
export function RemiseElectronique({ etat }: { etat: EtatRemise }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const papier = etat.mode === "papier";

  async function choisir(demandePapier: boolean) {
    if (demandePapier && !(await confirmer({ titre: "Recevoir désormais vos bulletins sur papier ?", message: "Vous pourrez revenir à la remise électronique à tout moment.", action: "Passer au papier" }))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/paie/remise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ papier: demandePapier }) });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setMessage({ ok: true, texte: demandePapier ? "Demande enregistrée : la direction en est informée." : "Remise électronique rétablie." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : "Erreur inattendue" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 flex flex-col gap-2 text-sm">
      <p className="font-semibold">Remise de vos bulletins</p>
      <p className="text-navy/75">{INFORMATION_REMISE}</p>
      <p>
        <span className={papier ? "badge-gold" : "badge-teal"}>{papier ? "Papier" : "Électronique"}</span> <span className="text-navy/70">{libelleEtat(etat)}</span>
      </p>
      <p className="text-xs text-navy/60">
        Durée de mise à disposition prévue par le code du travail : {DUREE_LEGALE_DISPONIBILITE}. Dans GODAC, vos bulletins restent consultables tant
        que l&apos;entreprise utilise GODAC : téléchargez-les régulièrement (bouton « Tous mes bulletins (ZIP) ») pour les conserver vous-même.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={busy} onClick={() => choisir(!papier)}>
          {busy ? "Enregistrement…" : papier ? "Revenir à la remise électronique" : "Je préfère recevoir mes bulletins sur papier"}
        </button>
        {message && (
          <span role={message.ok ? "status" : "alert"} className={message.ok ? "text-teal-ink" : "text-orange-ink"}>
            {message.texte}
          </span>
        )}
      </div>
    </Card>
  );
}
