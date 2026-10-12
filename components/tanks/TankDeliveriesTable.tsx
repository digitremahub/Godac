"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export interface TankDeliveryRow {
  id: string;
  tankName: string;
  liters: number;
  unitPrice: number | null;
  supplier: string | null;
  deliveredAt: string;
  invoiceUrl: string | null;
}

/**
 * Every recorded "approvisionnement" (org-wide, across tanks) with its
 * invoice, when there is one — and a way to attach one to a row that
 * doesn't have it yet, since the paper invoice from the supplier
 * usually turns up after the delivery was already logged.
 */
export function TankDeliveriesTable({ deliveries, canManage }: { deliveries: TankDeliveryRow[]; canManage: boolean }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function attachInvoice(deliveryId: string, file: File) {
    setBusyId(deliveryId);
    setError(null);
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const initRes = await fetch(`/api/tank-deliveries/${deliveryId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ext }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(typeof initJson.error === "string" ? initJson.error : "Erreur");

      const { error: uploadError } = await supabase.storage
        .from("tank-invoices")
        .upload(initJson.storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué: ${uploadError.message}`);

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  if (deliveries.length === 0) {
    return <EmptyState title="Aucun approvisionnement" description="Les approvisionnements enregistrés depuis la page Cuves apparaîtront ici." />;
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p className="mb-2 text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Date</th>
            <th className="pb-2">Cuve</th>
            <th className="pb-2">Litres</th>
            <th className="pb-2">Prix/L</th>
            <th className="pb-2">Fournisseur</th>
            <th className="pb-2">Facture</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.id} className="border-t border-navy/5">
              <td className="py-2">{new Date(d.deliveredAt).toLocaleDateString("fr-FR")}</td>
              <td className="py-2">{d.tankName}</td>
              <td className="py-2">{d.liters.toLocaleString("fr-FR")} L</td>
              <td className="py-2">{d.unitPrice ? `${d.unitPrice} €` : "—"}</td>
              <td className="py-2">{d.supplier ?? "—"}</td>
              <td className="py-2">
                {d.invoiceUrl ? (
                  <a href={d.invoiceUrl} target="_blank" rel="noreferrer" className="text-teal-ink hover:underline">
                    Télécharger
                  </a>
                ) : canManage ? (
                  <label className="cursor-pointer text-xs text-navy/65 underline">
                    {busyId === d.id ? "Envoi…" : "📎 Joindre"}
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      className="hidden"
                      disabled={busyId === d.id}
                      onChange={(e) => e.target.files?.[0] && attachInvoice(d.id, e.target.files[0])}
                    />
                  </label>
                ) : (
                  <span className="text-navy/60">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
