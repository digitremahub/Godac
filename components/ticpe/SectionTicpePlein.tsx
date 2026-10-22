"use client";

import { useState } from "react";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import type { TicpeDuPlein } from "@/lib/fuel/detail-plein";
import { MENTION_A_CONFIRMER } from "@/lib/ticpe/reglages";

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const litres = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} L`;
const ORIGINE_ZONE: Record<string, string> = { cuve: "zone de la cuve", station: "déduite de la station", defaut: "zone par défaut de l'entreprise" };

/** Bloc « Remboursement TICPE » de la fiche d'un plein. */
export function SectionTicpePlein({ entryId, ticpe, onModifie }: { entryId: string; ticpe: TicpeDuPlein; onModifie: () => Promise<void> }) {
  const [edition, setEdition] = useState(false);
  const [type, setType] = useState<"releve_carte" | "facture" | "">(ticpe.justificatif.type === "releve_carte" || ticpe.justificatif.type === "facture" ? ticpe.justificatif.type : "");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);

  async function enregistrer(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac(`/api/fuel-entries/${entryId}/justificatif`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type || null, ref: ref.trim() || null }),
    });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setEdition(false);
    await onModifie();
  }

  return (
    <div className="text-sm">
      {ticpe.statut === "exclu" ? (
        <p className="text-navy/70">Non compté : {ticpe.raison}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-navy/55">Montant récupérable</dt>
            <dd className="font-semibold text-navy">{ticpe.statut === "taux_manquant" ? <span className="text-orange-ink">taux manquant</span> : euros(ticpe.montant)}</dd>
          </div>
          <div>
            <dt className="text-xs text-navy/55">Taux</dt>
            <dd>
              {ticpe.taux === null ? "—" : `${ticpe.taux.toLocaleString("fr-FR")} €/hl`}
              {ticpe.origineTaux === "surcharge" && <span className="text-xs text-navy/55"> (taux particulier)</span>}
              {ticpe.tauxAConfirmer && <span className="block text-xs text-navy/55">{MENTION_A_CONFIRMER}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-navy/55">Zone</dt>
            <dd>
              {ticpe.zone ?? "—"}
              {ticpe.origineZone && <span className="block text-xs text-navy/55">{ORIGINE_ZONE[ticpe.origineZone] ?? ""}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-navy/55">Litres retenus</dt>
            <dd>
              {litres(ticpe.litresRetenus)}
              {ticpe.litresHorsPlafond > 0 && <span className="block text-xs text-orange-ink">{litres(ticpe.litresHorsPlafond)} au-delà du plafond</span>}
            </dd>
          </div>
          {ticpe.statut === "taux_manquant" && ticpe.raison && <p className="col-span-full text-xs text-orange-ink">{ticpe.raison}</p>}
        </dl>
      )}
      <p className={`mt-2 ${ticpe.justificatif.present ? "text-navy/70" : "text-orange-ink"}`}>
        Justificatif à conserver : {ticpe.justificatif.libelle}
        {ticpe.justificatifModifiable && !edition && (
          <button type="button" className="btn-ghost ml-2 !px-2 !py-0.5 text-xs" onClick={() => setEdition(true)}>
            {ticpe.justificatif.present ? "Modifier" : "Déclarer un relevé ou une facture"}
          </button>
        )}
      </p>
      {edition && (
        <form onSubmit={enregistrer} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-navy/10 bg-surface p-3">
          <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
          <label className="block">
            <span className="label">Justificatif</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="">Aucun</option>
              <option value="releve_carte">Relevé de carte carburant</option>
              <option value="facture">Facture carburant</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Référence (facultatif)</span>
            <input className="input" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setEdition(false)}>
            Annuler
          </button>
        </form>
      )}
    </div>
  );
}
