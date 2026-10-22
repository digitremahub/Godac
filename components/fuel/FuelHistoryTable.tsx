"use client";

import { Fragment, useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { BadgeStatutEcart, FuelEntryDetail } from "@/components/fuel/FuelEntryDetail";
import type { StatutEcart } from "@/lib/fuel/ecarts";

export interface FuelHistoryRow {
  id: string;
  occurred_at: string;
  liters: number | null;
  total_amount: number | null;
  status: string;
  gap_flagged?: boolean | null;
  product?: string | null;
  station_name?: string | null;
  tank_id?: string | null;
  tanks?: { name: string } | null;
  vehicles?: { registration: string } | null;
  users?: { full_name: string } | null;
  /** Statut de l'écart (calculé côté serveur, lib/fuel/ecarts.ts) ; à défaut, gap_flagged. */
  statut_ecart?: StatutEcart;
  /** Montant TICPE affiché (« 12,45 € », « taux manquant », « non éligible ») ; absent : colonne masquée. */
  ticpe?: string | null;
}

/** « Cuve X » pour un plein à la cuve, « Station Y » pour un achat en station. */
function sourceLabel(e: FuelHistoryRow): string {
  if (e.tanks?.name) return `Cuve ${e.tanks.name}`;
  if (e.tank_id) return "Cuve";
  return e.station_name ? `Station ${e.station_name}` : "Station";
}

function StatusBadge({ status, gapFlagged, statutEcart }: { status: string; gapFlagged?: boolean | null; statutEcart?: StatutEcart }) {
  if (statutEcart && statutEcart !== "aucun") return <BadgeStatutEcart statut={statutEcart} />;
  if (!statutEcart && gapFlagged) return <span className="badge-orange">Écart détecté</span>;
  const map: Record<string, { cls: string; label: string }> = {
    manual: { cls: "badge-neutral", label: "Manuel" },
    validated: { cls: "badge-teal", label: "Validé" },
    pending_ocr: { cls: "badge-gold", label: "OCR en cours" },
    awaiting_validation: { cls: "badge-gold", label: "À valider" },
    ocr_failed: { cls: "badge-orange", label: "Échec OCR" },
  };
  const s = map[status] ?? { cls: "badge-neutral", label: status };
  return <span className={s.cls}>{s.label}</span>;
}

/**
 * Shared "who had which vehicle when" table, driven by fuel_entries
 * (the only table with real per-day driver+vehicle data today — see
 * app/(dashboard)/fuel/page.tsx, the vehicle detail page's
 * "Historique des chauffeurs", and the driver detail page's
 * "Historique des véhicules"). Hide whichever of the vehicle/driver
 * columns is redundant given the page's own context.
 *
 * Chaque ligne se déplie sur la fiche complète du plein (tout ce qui a
 * été saisi, photos, OCR, corrections, écarts et leur traitement).
 */
export function FuelHistoryTable({
  entries,
  showVehicle = true,
  showDriver = true,
  emptyDescription = "Aucun plein enregistré pour l'instant.",
  initialOpenId,
}: {
  entries: FuelHistoryRow[];
  showVehicle?: boolean;
  showDriver?: boolean;
  emptyDescription?: string;
  /** Plein dont la fiche est ouverte d'emblée (lien d'une alerte, ?plein=). */
  initialOpenId?: string;
}) {
  const [ouvert, setOuvert] = useState<string | null>(initialOpenId ?? null);
  const showTicpe = entries.some((e) => e.ticpe !== undefined);
  if (entries.length === 0) {
    return <EmptyState title="Aucun historique" description={emptyDescription} />;
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Date</th>
            {showVehicle && <th className="pb-2">Véhicule</th>}
            {showDriver && <th className="pb-2">Chauffeur</th>}
            <th className="pb-2">Produit</th>
            <th className="pb-2">Origine</th>
            <th className="pb-2">Litres</th>
            <th className="pb-2">Montant</th>
            {showTicpe && <th className="pb-2">TICPE</th>}
            <th className="pb-2">Statut</th>
            <th className="pb-2">
              <span className="sr-only">Détails</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const estOuvert = ouvert === e.id;
            const colonnes = 7 + (showVehicle ? 1 : 0) + (showDriver ? 1 : 0) + (showTicpe ? 1 : 0);
            return (
              <Fragment key={e.id}>
                <tr className={`border-t border-navy/5 ${estOuvert ? "bg-navy/[0.02]" : ""}`}>
                  <td className="py-2">{new Date(e.occurred_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                  {showVehicle && <td className="py-2">{e.vehicles?.registration ?? "—"}</td>}
                  {showDriver && <td className="py-2">{e.users?.full_name ?? "—"}</td>}
                  <td className="py-2">{e.product === "adblue" ? "AdBlue" : "Gazole"}</td>
                  <td className="py-2">{sourceLabel(e)}</td>
                  <td className="py-2">{e.liters ?? "—"} L</td>
                  <td className="py-2">{e.total_amount ?? "—"} €</td>
                  {showTicpe && <td className={`py-2 ${e.ticpe === "taux manquant" ? "text-orange-ink" : e.ticpe === "non éligible" ? "text-navy/50" : ""}`}>{e.ticpe ?? "—"}</td>}
                  <td className="py-2">
                    <StatusBadge status={e.status} gapFlagged={e.gap_flagged} statutEcart={e.statut_ecart} />
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      className="btn-ghost !px-2 !py-1 text-xs"
                      aria-expanded={estOuvert}
                      aria-controls={`plein-${e.id}`}
                      onClick={() => setOuvert(estOuvert ? null : e.id)}
                    >
                      {estOuvert ? "Masquer" : "Détails"}
                    </button>
                  </td>
                </tr>
                {estOuvert && (
                  <tr id={`plein-${e.id}`}>
                    <td colSpan={colonnes} className="pb-3">
                      <FuelEntryDetail entryId={e.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
