"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import { confirmer } from "@/lib/ui/confirmation";
import type { PeriodeDeclaration } from "@/lib/ticpe/echeances";
import type { RegimeTva } from "@/lib/ticpe/reglages";

/** « Marquer déclarée » : date de dépôt et montant demandé (prérempli avec le montant calculé). */
export function MarquerDeclaree({
  periode,
  regime,
  montantCalcule,
  litres,
  aujourdhui,
}: {
  periode: PeriodeDeclaration;
  regime: RegimeTva;
  montantCalcule: number;
  litres: number;
  aujourdhui: string;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [date, setDate] = useState(aujourdhui);
  const [montant, setMontant] = useState(montantCalcule.toFixed(2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);

  async function envoyer(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac("/api/ticpe/declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periode_cle: periode.cle,
        periode_libelle: periode.libelle,
        periode_debut: periode.debut,
        periode_fin: periode.fin,
        regime_tva: regime,
        declaree_le: date,
        montant: Number(montant.replace(",", ".")),
        litres,
        montant_calcule: montantCalcule,
        note: note.trim() || null,
      }),
    });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setOuvert(false);
    router.refresh();
  }

  if (!ouvert) {
    return (
      <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => setOuvert(true)}>
        Marquer déclarée
      </button>
    );
  }
  return (
    <form onSubmit={envoyer} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-navy/10 bg-surface p-2 text-sm">
      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
      <label className="block">
        <span className="label">Déclarée le</span>
        <input className="input" type="date" required max={aujourdhui} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Montant demandé (€)</span>
        <input className="input" inputMode="decimal" required value={montant} onChange={(e) => setMontant(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Note (facultatif)</span>
        <input className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
      <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </form>
  );
}

/** Annule une déclaration marquée par erreur. */
export function AnnulerDeclaration({ id, libelle }: { id: string; libelle: string }) {
  const router = useRouter();
  const [refus, setRefus] = useState<Refus | null>(null);
  async function annuler() {
    const ok = await confirmer({ titre: `Annuler la déclaration de ${libelle} ?`, message: "La période redeviendra « non réclamée ». La ligne reste visible, barrée.", action: "Annuler la déclaration" });
    if (!ok) return;
    const r = await fetchGodac(`/api/ticpe/declarations/${id}`, { method: "PATCH" });
    if (!r.ok) return setRefus(r.refus);
    router.refresh();
  }
  return (
    <>
      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void annuler()}>
        Annuler
      </button>
    </>
  );
}
