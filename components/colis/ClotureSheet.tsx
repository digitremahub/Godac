"use client";

import { useState } from "react";
import { IconCheck, IconRamasse, IconX } from "@/components/layout/icons";
import { motifsPour, type MotifEchec } from "@/lib/colis/cloture";
import { estRamasse } from "@/lib/colis/livraison";
import { BadgeRamasse } from "@/components/colis/Ramasse";
import type { Stop } from "@/components/colis/commun";

/**
 * Clôture d'un arrêt, dans l'ordre ou non : livré (la feuille de
 * livraison s'ouvre ensuite, avec ses modes de remise et preuves ; une
 * ramasse est simplement marquée faite) ou échec / absent avec motif.
 * `mode="echec"` ouvre directement le choix du motif (bouton « Absent »).
 */
export function ClotureSheet({
  stop,
  numero,
  horsOrdre,
  mode = "choix",
  onLivrer,
  onEchec,
  onClose,
}: {
  stop: Stop;
  numero: number;
  /** L'arrêt n'est pas le prochain dans l'ordre de passage. */
  horsOrdre: boolean;
  mode?: "choix" | "echec";
  onLivrer: () => void;
  onEchec: (motif: MotifEchec, precision: string | null) => Promise<void> | void;
  onClose: () => void;
}) {
  const ramasse = estRamasse(stop);
  const [motif, setMotif] = useState<MotifEchec | null>(mode === "echec" ? "absent" : null);
  const [precision, setPrecision] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function signalerRamasse(motifRapide: "rien_a_ramasser" | "ferme") {
    setEnvoi(true);
    try {
      await onEchec(motifRapide, null);
    } finally {
      setEnvoi(false);
    }
  }

  async function valider() {
    if (!motif) return;
    setEnvoi(true);
    try {
      await onEchec(motif, precision.trim() || null);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="cloture-titre">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-ink">
              {ramasse && <BadgeRamasse />}
              Arrêt {numero}
            </p>
            <h2 id="cloture-titre" className="font-display text-lg font-bold leading-snug">
              {stop.address}
            </h2>
            {stop.recipient && <p className="text-sm text-navy/65">{stop.recipient}</p>}
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Fermer">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {horsOrdre && <p className="rounded-lg bg-navy/[0.05] px-3 py-2 text-xs text-navy/70">Arrêt hors de l&apos;ordre prévu : le prochain arrêt de la tournée ne change pas.</p>}

        {motif === null ? (
          <div className="grid grid-cols-1 gap-2">
            <button type="button" className="btn-primary justify-center !py-4 text-lg" disabled={envoi} onClick={onLivrer}>
              {ramasse ? <IconRamasse className="h-6 w-6" /> : <IconCheck className="h-6 w-6" />} {ramasse ? "Colis ramassés" : "Livré"}
            </button>
            {ramasse ? (
              <>
                <button type="button" className="btn-secondary justify-center !py-4" disabled={envoi} onClick={() => void signalerRamasse("rien_a_ramasser")}>
                  Pas de colis
                </button>
                <button type="button" className="btn-secondary justify-center !py-4 text-orange-ink" disabled={envoi} onClick={() => void signalerRamasse("ferme")}>
                  <IconX className="h-5 w-5" /> Fermé
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary justify-center !py-4 text-orange-ink" disabled={envoi} onClick={() => setMotif("absent")}>
                <IconX className="h-5 w-5" /> Échec / absent
              </button>
            )}
          </div>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">Motif de l&apos;échec</legend>
            <div className="grid grid-cols-2 gap-2">
              {motifsPour(ramasse).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={motif === m.key}
                  onClick={() => setMotif(m.key)}
                  className={`rounded-xl border px-3 py-3 text-left text-sm transition-colors ${motif === m.key ? "border-orange bg-orange/10 font-semibold" : "border-navy/10 hover:border-navy/25"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <input
              className="input mt-1"
              value={precision}
              onChange={(e) => setPrecision(e.target.value)}
              maxLength={200}
              placeholder={motif === "autre" ? "Précisez le motif" : "Précision (facultatif) : avis de passage, code porte…"}
              aria-label="Précision sur l'échec"
            />
            <button type="button" className="btn-primary mt-1 justify-center !py-3.5 text-base" disabled={envoi || (motif === "autre" && !precision.trim())} onClick={valider}>
              {envoi ? "Envoi…" : "Valider l'échec"}
            </button>
            {mode === "choix" && (
              <button type="button" className="btn-ghost w-fit !px-2 text-sm" onClick={() => setMotif(null)}>
                ‹ Retour
              </button>
            )}
          </fieldset>
        )}
      </div>
    </div>
  );
}
