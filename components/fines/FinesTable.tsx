"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

export interface FineRow {
  id: string;
  infraction_at: string;
  amount: number;
  reference: string | null;
  status: "pending_identification" | "identified" | "contested" | "paid";
  notified_at: string | null;
  vehicles: { registration: string } | null;
  driver: { full_name: string } | null;
  suggested_driver_name: string | null;
  suggested_tour_number: string | null;
}

const STATUS_LABEL: Record<FineRow["status"], string> = {
  pending_identification: "À identifier",
  identified: "Chauffeur confirmé",
  contested: "Contestée",
  paid: "Payée",
};

const STATUS_BADGE: Record<FineRow["status"], string> = {
  pending_identification: "badge-gold",
  identified: "badge-teal",
  contested: "badge-neutral",
  paid: "badge-teal",
};

/** Actions de l'encadrement (direction ; managers sur les véhicules de leur service, RLS) (confirm/notify/status) — see app/api/fines/[id], which re-checks the role server-side. */
export function FinesTable({ fines, lectureSeule = false }: { fines: FineRow[]; /** Comptable : consultation sans action. */ lectureSeule?: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/fines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[980px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Date</th>
            <th className="pb-2">Véhicule</th>
            <th className="pb-2">Montant</th>
            <th className="pb-2">Référence</th>
            <th className="pb-2">Chauffeur</th>
            <th className="pb-2">Statut</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {fines.map((f) => (
            <tr key={f.id} className="border-t border-navy/5">
              <td className="py-2">{new Date(f.infraction_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}</td>
              <td className="py-2">{f.vehicles?.registration ?? "—"}</td>
              <td className="py-2">{f.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</td>
              <td className="py-2">{f.reference ?? "—"}</td>
              <td className="py-2">
                {f.driver?.full_name ?? (
                  f.suggested_driver_name ? (
                    <span className="text-navy/70">
                      Suggéré : {f.suggested_driver_name}
                      {f.suggested_tour_number ? ` (n°${f.suggested_tour_number})` : ""}
                    </span>
                  ) : (
                    "—"
                  )
                )}
              </td>
              <td className="py-2">
                <span className={STATUS_BADGE[f.status]}>{STATUS_LABEL[f.status]}</span>
              </td>
              <td className="py-2">
                {!lectureSeule && <div className="flex flex-wrap gap-1.5">
                  {f.status === "pending_identification" && f.suggested_driver_name && (
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      disabled={busyId === f.id}
                      onClick={() => patch(f.id, { confirm: true })}
                    >
                      Confirmer
                    </button>
                  )}
                  {f.driver && !f.notified_at && (
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      disabled={busyId === f.id}
                      onClick={() => patch(f.id, { notify: true })}
                    >
                      Notifier le chauffeur
                    </button>
                  )}
                  {f.notified_at && <span className="text-xs text-navy/60">Notifié</span>}
                  {f.status === "identified" && (
                    <button
                      className="text-xs text-navy/60 hover:text-orange-ink"
                      disabled={busyId === f.id}
                      onClick={() => patch(f.id, { status: "contested" })}
                    >
                      Contester
                    </button>
                  )}
                  {(f.status === "identified" || f.status === "contested") && (
                    <button
                      className="text-xs text-navy/60 hover:text-teal-ink"
                      disabled={busyId === f.id}
                      onClick={() => patch(f.id, { status: "paid" })}
                    >
                      Marquer payée
                    </button>
                  )}
                </div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
