"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconRefresh } from "@/components/layout/icons";

/**
 * "En cas d'erreur" — régénère une fiche déjà générée à partir des
 * données actuelles (salaire corrigé entre temps sur /payroll, SIRET
 * enfin renseigné, etc.), en écrasant le fichier existant plutôt que
 * d'en créer un second pour la même période (la contrainte unique
 * user_id/période empêche de toute façon une seconde ligne — c'est
 * tout le problème que ce bouton résout). Panier repas/prime restent
 * éditables ici pour corriger une saisie initiale erronée, pré-remplis
 * avec les valeurs déjà enregistrées.
 */
export function RegeneratePayslipButton({
  payslipId,
  initialMealVouchers,
  initialBonus,
}: {
  payslipId: string;
  initialMealVouchers: number;
  initialBonus: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mealVouchers, setMealVouchers] = useState(initialMealVouchers > 0 ? String(initialMealVouchers) : "");
  const [bonus, setBonus] = useState(initialBonus > 0 ? String(initialBonus) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/payslips/${payslipId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meal_vouchers_amount: mealVouchers.trim() === "" ? 0 : Number(mealVouchers),
          bonus_amount: bonus.trim() === "" ? 0 : Number(bonus),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="text-xs text-navy/60 hover:text-teal-ink hover:underline" onClick={() => setOpen(true)}>
        <IconRefresh className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Mettre à jour
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <input
        className="input !h-7 !w-20 !py-0.5 !text-xs"
        type="number"
        min={0}
        step={0.01}
        aria-label="Panier €" placeholder="Panier €"
        value={mealVouchers}
        onChange={(e) => setMealVouchers(e.target.value)}
        disabled={busy}
      />
      <input
        className="input !h-7 !w-20 !py-0.5 !text-xs"
        type="number"
        min={0}
        step={0.01}
        aria-label="Prime €" placeholder="Prime €"
        value={bonus}
        onChange={(e) => setBonus(e.target.value)}
        disabled={busy}
      />
      <button className="btn-primary !h-6 !px-2 !py-0 !text-xs" disabled={busy} onClick={confirm}>
        {busy ? "…" : "Écraser"}
      </button>
      <button className="btn-secondary !h-6 !px-2 !py-0 !text-xs" disabled={busy} onClick={() => setOpen(false)}>
        Annuler
      </button>
      {error && <span role="alert" className="text-xs text-orange-ink">{error}</span>}
    </span>
  );
}
