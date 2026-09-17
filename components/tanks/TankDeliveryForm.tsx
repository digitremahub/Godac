"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TankDeliveryForm({ tankId }: { tankId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [liters, setLiters] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tank-deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tank_id: tankId,
          liters: Number(liters),
          unit_price: unitPrice ? Number(unitPrice) : undefined,
          supplier: supplier || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setLiters("");
      setUnitPrice("");
      setSupplier("");
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
      <button className="btn-secondary w-full" onClick={() => setOpen(true)}>
        + Approvisionnement
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {error && <p className="text-xs text-orange">{error}</p>}
      <input className="input !py-1 text-sm" type="number" placeholder="Litres livrés" value={liters} onChange={(e) => setLiters(e.target.value)} />
      <input
        className="input !py-1 text-sm"
        type="number"
        placeholder="Prix/L (optionnel)"
        value={unitPrice}
        onChange={(e) => setUnitPrice(e.target.value)}
      />
      <input
        className="input !py-1 text-sm"
        placeholder="Fournisseur (optionnel)"
        value={supplier}
        onChange={(e) => setSupplier(e.target.value)}
      />
      <div className="flex gap-2">
        <button className="btn-primary flex-1 !py-1.5 text-sm" disabled={busy || !liters} onClick={submit}>
          {busy ? "Envoi…" : "Enregistrer"}
        </button>
        <button className="btn-secondary !py-1.5 text-sm" disabled={busy} onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}
