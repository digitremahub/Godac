"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { IconPaperclip } from "@/components/layout/icons";

export function TankDeliveryForm({ tankId }: { tankId: string }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [open, setOpen] = useState(false);
  const [liters, setLiters] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [deliveredOn, setDeliveredOn] = useState(aujourdhui());
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
          unit_price: Number(unitPrice),
          delivered_at: deliveredOn && deliveredOn !== aujourdhui() ? new Date(`${deliveredOn}T12:00`).toISOString() : undefined,
          supplier: supplier || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");

      if (invoiceFile) {
        const ext = invoiceFile.name.split(".").pop() || "pdf";
        const initRes = await fetch(`/api/tank-deliveries/${json.delivery.id}/invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ext }),
        });
        const initJson = await initRes.json();
        if (!initRes.ok) throw new Error(typeof initJson.error === "string" ? initJson.error : "Erreur facture");
        const { error: uploadError } = await supabase.storage
          .from("tank-invoices")
          .upload(initJson.storagePath, invoiceFile, { contentType: invoiceFile.type });
        if (uploadError) throw new Error(`Envoi de la facture échoué: ${uploadError.message}`);
      }

      setLiters("");
      setUnitPrice("");
      setSupplier("");
      setInvoiceFile(null);
      setDeliveredOn(aujourdhui());
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
      {error && <p role="alert" className="text-xs text-orange-ink">{error}</p>}
      <input className="input !py-1 text-sm" type="number" aria-label="Litres livrés" placeholder="Litres livrés" value={liters} onChange={(e) => setLiters(e.target.value)} />
      <input
        className="input !py-1 text-sm"
        type="number"
        step="0.0001"
        min="0"
        aria-label="Prix au litre TTC (facture)" placeholder="Prix au litre TTC (facture)"
        value={unitPrice}
        onChange={(e) => setUnitPrice(e.target.value)}
      />
      <input
        className="input !py-1 text-sm"
        type="date"
        aria-label="Date de livraison"
        max={aujourdhui()}
        value={deliveredOn}
        onChange={(e) => setDeliveredOn(e.target.value)}
      />
      <input
        className="input !py-1 text-sm"
        aria-label="Fournisseur (optionnel)" placeholder="Fournisseur (optionnel)"
        value={supplier}
        onChange={(e) => setSupplier(e.target.value)}
      />
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-navy/20 px-2 py-1.5 text-xs text-navy/65">
        {invoiceFile ? invoiceFile.name : <><IconPaperclip className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Joindre la facture (optionnel)</>}
        <input
          type="file"
          accept="application/pdf,image/*"
          className="sr-only"
          onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <div className="flex gap-2">
        <button className="btn-primary flex-1 !py-1.5 text-sm" disabled={busy || !(Number(liters) > 0) || !(Number(unitPrice) > 0)} onClick={submit}>
          {busy ? "Envoi…" : "Enregistrer"}
        </button>
        <button className="btn-secondary !py-1.5 text-sm" disabled={busy} onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/** Date du jour (heure locale), au format AAAA-MM-JJ. */
function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
