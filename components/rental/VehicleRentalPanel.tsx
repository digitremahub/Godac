"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { OWNERSHIP_LABELS, type VehicleOwnership } from "@/lib/rental/workflow";

export interface VehicleRentalInfo {
  ownership: VehicleOwnership;
  rental_provider_id: string | null;
  rental_contract_ref: string | null;
  rental_start_date: string | null;
  rental_end_date: string | null;
  rental_km_allowance: number | null;
  rental_start_km: number | null;
}

export interface KmSummary {
  levelLabel: string;
  level: "ok" | "surveiller" | "proche" | "depasse";
  drivenKm: string;
  prorataKm: string;
  projectedKm: string;
}

const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Encart « Location » de la fiche véhicule : résumé du contrat et formulaire (responsables). */
export function VehicleRentalPanel({
  vehicleId,
  info,
  providerName,
  providers,
  canEdit,
  daysLeft,
  km,
  orphanInterventions,
}: {
  vehicleId: string;
  info: VehicleRentalInfo;
  providerName: string | null;
  providers: { id: string; name: string }[];
  canEdit: boolean;
  daysLeft: number | null;
  km: KmSummary | null;
  orphanInterventions: { id: string; type: string; created_at: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    ownership: info.ownership,
    rental_provider_id: info.rental_provider_id ?? "",
    rental_contract_ref: info.rental_contract_ref ?? "",
    rental_start_date: info.rental_start_date ?? "",
    rental_end_date: info.rental_end_date ?? "",
    rental_km_allowance: info.rental_km_allowance?.toString() ?? "",
    rental_start_km: info.rental_start_km?.toString() ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rented = info.ownership !== "propre";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const isOwn = draft.ownership === "propre";
    const orNull = (v: string) => (isOwn || v.trim() === "" ? null : v.trim());
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownership: draft.ownership,
          rental_provider_id: orNull(draft.rental_provider_id),
          rental_contract_ref: orNull(draft.rental_contract_ref),
          rental_start_date: orNull(draft.rental_start_date),
          rental_end_date: orNull(draft.rental_end_date),
          rental_km_allowance: orNull(draft.rental_km_allowance),
          rental_start_km: orNull(draft.rental_start_km),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Vérifiez les champs (dates, kilométrages).");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  async function openRequest(interventionId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rental-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervention_id: interventionId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Impossible d'ouvrir la demande.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <Card className="w-full">
      <div id="location" className="flex items-start justify-between gap-2">
        <p className="text-sm text-navy/65">Location</p>
        {canEdit && !editing && (
          <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setEditing(true)}>
            Modifier
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-2 flex flex-col gap-2 text-sm">
          <label>
            Détention
            <select className="input mt-1" value={draft.ownership} onChange={set("ownership")}>
              {Object.entries(OWNERSHIP_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {draft.ownership !== "propre" && (
            <>
              <label>
                Loueur / prestataire
                <select className="input mt-1" value={draft.rental_provider_id} onChange={set("rental_provider_id")}>
                  <option value="">— Aucun —</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {providers.length === 0 && (
                <Link href="/flotte/loueurs/prestataires" className="text-xs text-teal-ink hover:underline">
                  Ajouter un loueur →
                </Link>
              )}
              <label>
                N° de contrat
                <input className="input mt-1" maxLength={120} value={draft.rental_contract_ref} onChange={set("rental_contract_ref")} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  Début
                  <input type="date" className="input mt-1" value={draft.rental_start_date} onChange={set("rental_start_date")} />
                </label>
                <label>
                  Fin
                  <input type="date" className="input mt-1" value={draft.rental_end_date} onChange={set("rental_end_date")} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  Forfait km (total contrat)
                  <input type="number" min={1} step={1} className="input mt-1" value={draft.rental_km_allowance} onChange={set("rental_km_allowance")} />
                </label>
                <label>
                  Km au début du contrat
                  <input type="number" min={0} step={1} className="input mt-1" value={draft.rental_start_km} onChange={set("rental_start_km")} />
                </label>
              </div>
            </>
          )}
          {error && <p role="alert" className="text-orange-ink">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary !px-3 !py-1.5 text-sm" disabled={busy}>
              Enregistrer
            </button>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={busy} onClick={() => setEditing(false)}>
              Annuler
            </button>
          </div>
        </form>
      ) : rented ? (
        <div className="mt-1 text-sm">
          <p className="text-base">
            Véhicule loué{providerName ? ` chez ${providerName}` : ""} <span className="badge-neutral ml-1">{OWNERSHIP_LABELS[info.ownership]}</span>
          </p>
          <p className="text-navy/70">
            {info.rental_contract_ref ? `Contrat ${info.rental_contract_ref}` : "Contrat non renseigné"}
            {info.rental_end_date ? ` · fin le ${fmtDate(info.rental_end_date)}` : ""}
            {daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && <span className="badge-gold ml-1">J-{daysLeft}</span>}
            {daysLeft !== null && daysLeft < 0 && <span className="badge-orange ml-1">Échu</span>}
          </p>
          {info.rental_km_allowance ? (
            <p className="text-navy/70">
              Forfait {info.rental_km_allowance.toLocaleString("fr-FR").replace(/[  ]/g, " ")} km
              {km && (
                <>
                  {" "}
                  · {km.drivenKm} parcourus (prorata {km.prorataKm}, projection {km.projectedKm}){" "}
                  <span className={km.level === "ok" ? "badge-teal" : km.level === "depasse" ? "badge-orange" : "badge-gold"}>{km.levelLabel}</span>
                </>
              )}
            </p>
          ) : null}
          {!providerName && <p className="mt-1 text-xs text-orange-ink">Aucun loueur rattaché : les demandes d&apos;entretien ne lui seront pas transmises.</p>}
          {canEdit && orphanInterventions.length > 0 && providerName && (
            <div className="mt-2 border-t border-navy/5 pt-2">
              <p className="text-xs text-navy/60">Interventions en cours non transmises au loueur :</p>
              {orphanInterventions.map((i) => (
                <button key={i.id} className="btn-secondary mr-2 mt-1 !px-2 !py-1 text-xs" disabled={busy} onClick={() => openRequest(i.id)}>
                  {i.type} → à valider pour le loueur
                </button>
              ))}
            </div>
          )}
          {error && <p role="alert" className="mt-1 text-orange-ink">{error}</p>}
        </div>
      ) : (
        <p className="mt-1 text-sm">Véhicule en propre.</p>
      )}
    </Card>
  );
}
