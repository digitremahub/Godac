"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmer } from "@/lib/ui/confirmation";
import { networkErrorMessage } from "@/lib/utils/network-error";

/** Valider / refuser (avec motif) un arrêt déclaré ; libérer les affectations du planning. */
export function ActionsArret({ id, statut, peutDecider, aLiberer }: { id: string; statut: "recu" | "valide" | "refuse"; peutDecider: boolean; aLiberer: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function appeler(url: string, method: "PATCH" | "POST", body?: object) {
    setBusy(true);
    setErreur(null);
    setInfo(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const json = (await res.json().catch(() => ({}))) as { error?: string; liberees?: number };
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Action impossible");
      if (typeof json.liberees === "number") setInfo(`${json.liberees} affectation${json.liberees > 1 ? "s" : ""} libérée${json.liberees > 1 ? "s" : ""} : tournée${json.liberees > 1 ? "s" : ""} à réattribuer au planning.`);
      setRefus(false);
      router.refresh();
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function liberer() {
    const ok = await confirmer({
      titre: `Libérer ${aLiberer} affectation${aLiberer > 1 ? "s" : ""} ?`,
      message: "Le salarié est retiré de ses tournées prévues pendant l'arrêt. Les tournées restent au planning, sans chauffeur, à réattribuer.",
      action: "Libérer",
    });
    if (ok) await appeler(`/api/arrets/${id}/liberer`, "POST");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {peutDecider && statut !== "valide" && (
          <button type="button" className="btn-primary min-h-[44px]" disabled={busy} onClick={() => appeler(`/api/arrets/${id}`, "PATCH", { action: "valider" })}>
            Valider
          </button>
        )}
        {peutDecider && statut !== "refuse" && !refus && (
          <button type="button" className="btn-secondary min-h-[44px]" disabled={busy} onClick={() => setRefus(true)}>
            Refuser
          </button>
        )}
        {aLiberer > 0 && statut !== "refuse" && (
          <button type="button" className="btn-secondary min-h-[44px]" disabled={busy} onClick={liberer}>
            Libérer ces {aLiberer} affectation{aLiberer > 1 ? "s" : ""}
          </button>
        )}
      </div>
      {refus && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="label">Motif du refus (envoyé au salarié)</span>
            <input className="input" value={motif} maxLength={300} onChange={(e) => setMotif(e.target.value)} placeholder="Photo illisible, dates incohérentes…" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn-primary min-h-[44px]" disabled={busy || motif.trim().length < 3} onClick={() => appeler(`/api/arrets/${id}`, "PATCH", { action: "refuser", motif })}>
              Confirmer le refus
            </button>
            <button type="button" className="btn-ghost min-h-[44px]" onClick={() => setRefus(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {erreur && <p role="alert" className="text-sm text-orange-ink">{erreur}</p>}
      {info && <p role="status" className="text-sm text-teal-ink">{info}</p>}
    </div>
  );
}
