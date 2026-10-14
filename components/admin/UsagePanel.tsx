"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { formatEuro, libellePeriode, type LigneConsommation } from "@/lib/usage/quotas";

export interface HistoriqueMois {
  periode: string;
  unites: Record<string, number>;
  coutEstime: number;
}

/**
 * Carte « Consommation » de la page Abonnement : fonctions payantes du
 * mois (utilisé / inclus, dépassement et coût estimé), interrupteur du
 * dépassement facturé et six derniers mois.
 */
export function UsagePanel({
  lignes,
  historique,
  overageEnabled,
  periode,
}: {
  lignes: LigneConsommation[];
  historique: HistoriqueMois[];
  overageEnabled: boolean;
  periode: string;
}) {
  const [enabled, setEnabled] = useState(overageEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = lignes.reduce((s, l) => s + l.coutEstime, 0);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/usage/overage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      setEnabled(json.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg">Consommation</h2>
        <p className="text-sm text-navy/65">
          Lectures automatiques et assistant ({libellePeriode(periode)}). Chaque formule inclut un volume mensuel par fonction ;
          au-delà, chaque utilisation est facturée à l&apos;unité sur la facture suivante.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg bg-navy/[0.04] p-3">
        <div>
          <p className="font-medium">Autoriser le dépassement facturé</p>
          <p className="text-sm text-navy/65">
            Désactivé : une fonction s&apos;arrête dès que son volume inclus est atteint, jusqu&apos;au mois suivant (saisie manuelle
            toujours possible). Une limite de sécurité journalière s&apos;applique dans tous les cas.
          </p>
        </div>
        <button className={enabled ? "btn-primary !px-3 !py-1.5" : "btn-secondary !px-3 !py-1.5"} disabled={busy} onClick={toggle} aria-pressed={enabled}>
          {enabled ? "Activé" : "Désactivé"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-navy/60">
            <tr>
              <th className="pb-2">Fonction</th>
              <th className="pb-2 text-right">Utilisé / inclus</th>
              <th className="pb-2 text-right">Au-delà du forfait</th>
              <th className="pb-2 text-right">Prix unitaire HT</th>
              <th className="pb-2 text-right">Coût estimé HT</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.feature} className="border-t border-navy/5">
                <td className="py-2">
                  {l.libelle}
                  <div className="mt-1 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-navy/[0.08]" aria-hidden="true">
                    <div
                      className={`h-full rounded-full ${l.pourcentage >= 100 ? "bg-orange" : l.pourcentage >= 80 ? "bg-gold" : "bg-teal"}`}
                      style={{ width: `${Math.min(100, l.pourcentage)}%` }}
                    />
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {l.utilise.toLocaleString("fr-FR")} / {l.inclus.toLocaleString("fr-FR")}
                </td>
                <td className={`py-2 text-right tabular-nums ${l.depassement > 0 ? "font-semibold text-orange-ink" : "text-navy/50"}`}>
                  {l.depassement.toLocaleString("fr-FR")}
                </td>
                <td className="py-2 text-right tabular-nums">{formatEuro(l.prixUnitaire)}</td>
                <td className="py-2 text-right tabular-nums">{formatEuro(l.coutEstime)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-navy/10 font-semibold">
              <td className="pt-2" colSpan={4}>
                Total estimé du dépassement ce mois-ci
              </td>
              <td className="pt-2 text-right tabular-nums">{formatEuro(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <h3 className="mb-2 font-semibold">Six derniers mois</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Fonction</th>
                {historique.map((h) => (
                  <th key={h.periode} className="pb-2 text-right capitalize">
                    {libellePeriode(h.periode)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.feature} className="border-t border-navy/5">
                  <td className="py-1.5">{l.libelle}</td>
                  {historique.map((h) => (
                    <td key={h.periode} className="py-1.5 text-right tabular-nums">
                      {(h.unites[l.feature] ?? 0).toLocaleString("fr-FR")}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-navy/10 font-semibold">
                <td className="pt-2">Dépassement estimé HT</td>
                {historique.map((h) => (
                  <td key={h.periode} className="pt-2 text-right tabular-nums">
                    {formatEuro(h.coutEstime)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-navy/60">
          Estimation sur la base de votre formule actuelle ; le montant définitif figure sur la facture Stripe du mois suivant.
        </p>
      </div>
    </Card>
  );
}
