"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface ContributionLineRow {
  id: string;
  label: string;
  salarial_rate: number;
  patronal_rate: number;
}

/**
 * Grille de cotisations appliquée au brut de chaque bulletin généré
 * (voir lib/payslips/generate-pdf.tsx) — direction
 * uniquement, les taux viennent du logiciel de l'expert-comptable ou
 * de la convention collective, GODAC ne les invente pas.
 */
export function PayslipContributionLinesPanel({ lines }: { lines: ContributionLineRow[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [salarialRate, setSalarialRate] = useState("");
  const [patronalRate, setPatronalRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addLine() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payslip-contribution-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, salarial_rate: Number(salarialRate) || 0, patronal_rate: Number(patronalRate) || 0 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setLabel("");
      setSalarialRate("");
      setPatronalRate("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function updateLine(id: string, patch: Partial<{ label: string; salarial_rate: number; patronal_rate: number }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payslip-contribution-lines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function deleteLine(id: string) {
    if (!confirm("Supprimer cette ligne de cotisation ?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payslip-contribution-lines/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg">Détail des cotisations (bulletins de paie)</h3>
        <p className="text-sm text-navy/65">
          Chaque ligne ajoutée ici remplace la mention globale "Cotisations sociales (estimation)" sur les bulletins
          générés par une ligne détaillée (taux salarial appliqué au brut). Taux à reprendre de votre logiciel de
          paie ou auprès de votre expert-comptable — GODAC ne les calcule pas.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      {lines.length === 0 ? (
        <p className="text-sm text-navy/60">Aucune ligne configurée — les bulletins affichent l&apos;estimation globale.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
              <input aria-label="Libellé"
                className="input flex-1 !py-1"
                defaultValue={l.label}
                onBlur={(e) => e.target.value !== l.label && updateLine(l.id, { label: e.target.value })}
                disabled={busy}
              />
              <div className="flex items-center gap-1">
                <input aria-label="% salarial"
                  className="input !w-20 !py-1"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={l.salarial_rate}
                  onBlur={(e) => Number(e.target.value) !== l.salarial_rate && updateLine(l.id, { salarial_rate: Number(e.target.value) || 0 })}
                  disabled={busy}
                />
                <span className="text-xs text-navy/60">% salarial</span>
              </div>
              <div className="flex items-center gap-1">
                <input aria-label="% patronal"
                  className="input !w-20 !py-1"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  defaultValue={l.patronal_rate}
                  onBlur={(e) => Number(e.target.value) !== l.patronal_rate && updateLine(l.id, { patronal_rate: Number(e.target.value) || 0 })}
                  disabled={busy}
                />
                <span className="text-xs text-navy/60">% patronal</span>
              </div>
              <button className="btn-danger !px-2 !py-1 text-xs" disabled={busy} onClick={() => deleteLine(l.id)}>
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block"><span className="label">Libellé</span>
          <input className="input" placeholder="ex: Sécurité sociale" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        </div>
        <div className="w-28">
          <label className="block"><span className="label">% salarial</span>
          <input className="input" type="number" step="0.01" min={0} max={100} value={salarialRate} onChange={(e) => setSalarialRate(e.target.value)} /></label>
        </div>
        <div className="w-28">
          <label className="block"><span className="label">% patronal</span>
          <input className="input" type="number" step="0.01" min={0} max={100} value={patronalRate} onChange={(e) => setPatronalRate(e.target.value)} /></label>
        </div>
        <button className="btn-primary shrink-0" disabled={busy || !label} onClick={addLine}>
          Ajouter
        </button>
      </div>
    </Card>
  );
}
