"use client";

import { useState } from "react";
import { MOTIF_MAX, MOTIF_MIN, motifControleValide, type ControleSaisie } from "@/lib/fuel/controles-saisie";

/**
 * « Confirmer et signaler » : un contrôle de saisie (kilométrage, capacité du
 * réservoir) a échoué en fin de parcours. Rien n'est perdu : le chauffeur
 * corrige la saisie, ou confirme avec un motif court ; le plein est alors
 * enregistré et l'écart remonte à l'encadrement (« À traiter », écart carburant).
 */
export function ConfirmerControles({
  controles,
  busy,
  onConfirmer,
  onCorriger,
}: {
  controles: ControleSaisie[];
  busy?: boolean;
  onConfirmer: (motif: string) => void;
  onCorriger: () => void;
}) {
  const [motif, setMotif] = useState("");
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-orange/40 bg-orange/10 p-3 text-sm">
      <div>
        <p className="font-semibold text-orange-ink">{controles.length > 1 ? "Ces valeurs paraissent incohérentes" : "Cette valeur paraît incohérente"}</p>
        <ul className="mt-1 list-disc pl-5 text-navy/80">
          {controles.map((c) => (
            <li key={c.code}>{c.message}</li>
          ))}
        </ul>
        <p className="mt-1 text-navy/70">Corrigez la saisie si elle est fausse. Sinon, confirmez avec un motif : le plein est enregistré et l&apos;écart signalé à votre encadrement.</p>
      </div>
      <label className="block">
        <span className="label">Motif (obligatoire)</span>
        <input
          className="input min-h-[44px]"
          maxLength={MOTIF_MAX}
          placeholder="Ex. compteur remplacé, réservoir additionnel, erreur de l'ancien relevé"
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-[44px] flex-1" disabled={busy || !motifControleValide(motif)} onClick={() => onConfirmer(motif.trim())}>
          {busy ? "Enregistrement…" : "Confirmer et signaler"}
        </button>
        <button type="button" className="btn-secondary min-h-[44px] flex-1" disabled={busy} onClick={onCorriger}>
          Corriger la saisie
        </button>
      </div>
      {motif.trim().length > 0 && !motifControleValide(motif) && <p className="text-xs text-navy/60">{MOTIF_MIN} caractères au moins.</p>}
    </div>
  );
}
