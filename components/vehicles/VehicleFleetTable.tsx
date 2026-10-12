"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface VehicleRow {
  id: string;
  registration: string;
  type: string;
  status: string;
  tank_capacity_liters: number | null;
  services: { name: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  maintenance: "Entretien",
  out_of_service: "Hors service",
};

export function VehicleFleetTable({ vehicles }: { vehicles: VehicleRow[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const types = useMemo(() => Array.from(new Set(vehicles.map((v) => v.type))).sort(), [vehicles]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (term && !v.registration.toLowerCase().includes(term)) return false;
      if (typeFilter && v.type !== typeFilter) return false;
      if (statusFilter && v.status !== statusFilter) return false;
      return true;
    });
  }, [vehicles, search, typeFilter, statusFilter]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          className="input !w-56"
          placeholder="Rechercher une immatriculation…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input !w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">Tous les types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className="input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Aucun véhicule ne correspond" description="Essayez un autre terme ou réinitialisez les filtres." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Immatriculation</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Service</th>
                <th className="pb-2">Capacité réservoir</th>
                <th className="pb-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id} className="border-t border-navy/5">
                  <td className="py-2">
                    <Link href={`/vehicles/${v.id}`} className="text-teal-ink hover:underline">
                      {v.registration}
                    </Link>
                  </td>
                  <td className="py-2">{v.type}</td>
                  <td className="py-2">{v.services?.name ?? "—"}</td>
                  <td className="py-2">{v.tank_capacity_liters ? `${v.tank_capacity_liters} L` : "—"}</td>
                  <td className="py-2">
                    <span className={v.status === "active" ? "badge-teal" : v.status === "maintenance" ? "badge-gold" : "badge-orange"}>
                      {STATUS_LABELS[v.status] ?? v.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
