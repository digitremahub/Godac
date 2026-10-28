"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { confirmer } from "@/lib/ui/confirmation";

export interface EtatFinContrat {
  /** Date de fin retenue par les règles (AAAA-MM-JJ), ou null si le contrat n'est pas terminé / la date est inconnue. */
  finContrat: string | null;
  contratTermineLe: string | null;
  preavisEnvoyeLe: string | null;
  suppressionPrevue: string | null;
  bloquee: boolean;
  motif: string | null;
  bloqueeLe: string | null;
  bloqueePar: string | null;
}

/** Fin de contrat d'une organisation (back-office GODAC) : blocage de la suppression en cas de litige, date de fin hors Stripe. */
export function FinContratStaff({ organisationId, etat }: { organisationId: string; etat: EtatFinContrat }) {
  const router = useRouter();
  const [motif, setMotif] = useState("");
  const [date, setDate] = useState(etat.contratTermineLe ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(corps: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/godac-staff/organisations/${organisationId}/fin-contrat`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function bloquer() {
    if (!(await confirmer({ titre: "Bloquer la suppression des données ?", message: "Aucun préavis ni aucune suppression automatique tant que le blocage n'est pas levé.", action: "Bloquer", danger: true }))) return;
    await patch({ suppression_bloquee: true, motif });
    setMotif("");
  }

  return (
    <Card className="mb-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-navy">Fin de contrat et suppression des données</p>
        <p className="text-sm text-navy/70">
          {etat.finContrat ? `Contrat terminé le ${etat.finContrat}.` : "Contrat en cours, ou date de fin inconnue (aucune suppression automatique)."}
          {etat.preavisEnvoyeLe ? ` Préavis envoyé le ${etat.preavisEnvoyeLe}.` : ""}
          {etat.suppressionPrevue && !etat.bloquee ? ` Suppression au plus tôt le ${etat.suppressionPrevue}.` : ""}
        </p>
        <p className="text-xs text-navy/55">Préavis à fin + 60 jours, suppression à fin + 90 jours (au moins 30 jours après le préavis). Suppression réelle seulement si FIN_CONTRAT_PURGE_ACTIVE=true.</p>
      </div>

      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      {etat.bloquee ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-orange-ink">
            Suppression BLOQUÉE (litige){etat.bloqueeLe ? ` depuis le ${etat.bloqueeLe}` : ""}
            {etat.bloqueePar ? ` par ${etat.bloqueePar}` : ""} : {etat.motif ?? "motif non renseigné"}
          </p>
          <button className="btn-secondary w-fit" disabled={busy} onClick={() => patch({ suppression_bloquee: false })}>
            Lever le blocage
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-navy/70">
            Motif du litige (obligatoire)
            <input className="input" value={motif} maxLength={500} onChange={(e) => setMotif(e.target.value)} />
          </label>
          <button className="btn-secondary text-orange-ink" disabled={busy || motif.trim().length < 5} onClick={bloquer}>
            Bloquer la suppression
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-navy/5 pt-3">
        <label className="flex flex-col gap-1 text-xs text-navy/70">
          Date de fin de contrat (client facturé hors Stripe)
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="btn-secondary" disabled={busy || !date} onClick={() => patch({ contrat_termine_le: date })}>
          Enregistrer la date
        </button>
        {etat.contratTermineLe && (
          <button className="btn-secondary" disabled={busy} onClick={() => patch({ contrat_termine_le: null })}>
            Retirer la date
          </button>
        )}
      </div>
    </Card>
  );
}
