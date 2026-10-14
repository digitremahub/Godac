"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { IconCopy, IconPencil, IconTrash } from "@/components/layout/icons";
import { PoleIcon } from "@/components/shared/PoleBadge";
import { addDays, parisCalendarDate } from "@/lib/planning/dates";
import { heuresPresence, poleDe } from "@/lib/organization/poles";
import { formatHeures, heureParis } from "@/lib/planning/presence-bureau";

interface Person {
  id: string;
  full_name: string;
}
interface PresenceEntry {
  id: string;
  driver_id: string | null;
  start_at: string;
  end_at: string | null;
}

const DAY_LABELS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/**
 * Planning d'un pôle bureau (secrétariat, comptabilité…) : les
 * personnes rattachées au pôle, leurs horaires de présence jour par
 * jour et leur total de la semaine — pas de tournée ni de véhicule.
 * Les heures planifiées alimentent le préremplissage du bulletin de
 * paie (lib/paie/donnees.ts) une fois la journée passée.
 */
export function PresencePlanning({
  service,
  people,
  entries,
  weekStart,
  canEdit,
}: {
  service: { id: string; name: string; pole: string | null };
  people: Person[];
  entries: PresenceEntry[];
  weekStart: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const pole = poleDe(service.pole);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [jours, setJours] = useState<Set<number>>(new Set([0, 1, 2, 3, 4]));
  const [debut, setDebut] = useState("08:30");
  const [fin, setFin] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDebut, setEditDebut] = useState("");
  const [editFin, setEditFin] = useState("");

  const byPersonDay = new Map<string, PresenceEntry[]>();
  for (const e of entries) {
    if (!e.driver_id) continue;
    const key = `${e.driver_id}|${parisCalendarDate(e.start_at)}`;
    byPersonDay.set(key, [...(byPersonDay.get(key) ?? []), e]);
  }
  // Personnes planifiées mais plus rattachées au pôle : gardées à l'écran pour pouvoir les retirer.
  const extra = [...new Set(entries.map((e) => e.driver_id).filter((id): id is string => !!id && !people.some((p) => p.id === id)))].map((id) => ({
    id,
    full_name: "Personne retirée du pôle",
  }));
  const rows = [...people, ...extra];

  async function call(url: string, init: RequestInit, ok?: (json: any) => void) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      ok?.(json);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function ajouter() {
    if (!personId) return;
    void call("/api/planning/presence", {
      method: "POST",
      body: JSON.stringify({ action: "ajouter", service_id: service.id, user_id: personId, week_start: weekStart, days: [...jours], start: debut, end: fin }),
    });
  }

  function copierSemainePrecedente() {
    void call(
      "/api/planning/presence",
      {
        method: "POST",
        body: JSON.stringify({ action: "copier_semaine", service_id: service.id, source_week_start: addDays(weekStart, -7), target_week_start: weekStart }),
      },
      (json) => setInfo(json.created > 0 ? `${json.created} présence(s) copiée(s) depuis la semaine précédente.` : "Rien à copier (semaine précédente vide)."),
    );
  }

  async function enregistrer(id: string) {
    const ok = await call(`/api/planning/presence/${id}`, { method: "PATCH", body: JSON.stringify({ start: editDebut, end: editFin }) });
    if (ok) setEditingId(null);
  }

  function supprimer(id: string) {
    if (!window.confirm("Retirer cette présence du planning ?")) return;
    void call(`/api/planning/presence/${id}`, { method: "DELETE" });
  }

  function navTo(week: string) {
    const qs = new URLSearchParams();
    qs.set("week", week);
    qs.set("service", service.id);
    router.push(`/planning?${qs.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg">
              <PoleIcon pole={pole.key} className="h-5 w-5 text-navy/60" /> {service.name} — planning de présence
            </h3>
            <p className="text-sm text-navy/65">
              Pôle {pole.label} : horaires de présence des personnes rattachées, sans tournée ni véhicule.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(weekStart, -7))}>
              ← Semaine précédente
            </button>
            <span className="text-sm text-navy/70">
              Semaine du {new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
            </span>
            <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(weekStart, 7))}>
              Semaine suivante →
            </button>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        {info && <p role="status" className="text-sm text-teal-ink">{info}</p>}

        {rows.length === 0 ? (
          <p className="text-sm text-navy/65">
            Personne n&apos;est encore rattaché à ce pôle — depuis Utilisateurs, ouvrez la fiche d&apos;une personne et cochez
            « {service.name} » dans Services et pôles.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-navy/60">
                  <th className="pb-2">Personne</th>
                  {days.map((d, i) => (
                    <th key={d} className="pb-2">
                      {DAY_LABELS[i]} {Number(d.slice(8, 10))}
                    </th>
                  ))}
                  <th className="pb-2 text-right">Semaine</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const total = days.reduce(
                    (h, d) => h + (byPersonDay.get(`${p.id}|${d}`) ?? []).reduce((s, e) => s + heuresPresence(e.start_at, e.end_at), 0),
                    0,
                  );
                  return (
                    <tr key={p.id} className="border-t border-navy/10 align-top">
                      <td className="py-2 pr-2 font-medium">{p.full_name}</td>
                      {days.map((d) => (
                        <td key={d} className="py-2 pr-2">
                          {(byPersonDay.get(`${p.id}|${d}`) ?? []).map((e) =>
                            editingId === e.id ? (
                              <div key={e.id} className="flex flex-col gap-1">
                                <input aria-label="Arrivée" type="time" className="input !py-0.5 text-xs" value={editDebut} onChange={(ev) => setEditDebut(ev.target.value)} />
                                <input aria-label="Départ" type="time" className="input !py-0.5 text-xs" value={editFin} onChange={(ev) => setEditFin(ev.target.value)} />
                                <div className="flex gap-1">
                                  <button className="btn-primary !px-2 !py-0.5 text-xs" disabled={busy} onClick={() => enregistrer(e.id)}>
                                    OK
                                  </button>
                                  <button className="btn-secondary !px-2 !py-0.5 text-xs" onClick={() => setEditingId(null)}>
                                    Annuler
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div key={e.id} className="mb-1 rounded-lg bg-navy/[0.05] px-2 py-1">
                                <p className="whitespace-nowrap">
                                  {heureParis(e.start_at)}–{e.end_at ? heureParis(e.end_at) : "?"}
                                </p>
                                {canEdit && (
                                  <div className="mt-0.5 flex gap-1.5 text-navy/55">
                                    <button
                                      aria-label="Modifier les horaires"
                                      onClick={() => {
                                        setEditingId(e.id);
                                        setEditDebut(heureParis(e.start_at));
                                        setEditFin(e.end_at ? heureParis(e.end_at) : "17:00");
                                      }}
                                    >
                                      <IconPencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button aria-label="Retirer la présence" disabled={busy} onClick={() => supprimer(e.id)}>
                                      <IconTrash className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            ),
                          )}
                        </td>
                      ))}
                      <td className="py-2 text-right tabular-nums">{total > 0 ? formatHeures(Math.round(total * 100) / 100) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canEdit && people.length > 0 && (
        <Card className="flex flex-col gap-3">
          <p className="font-medium">Planifier une présence</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label">Personne</span>
              <select className="input !w-auto" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Arrivée</span>
              <input type="time" className="input !w-auto" value={debut} onChange={(e) => setDebut(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Départ</span>
              <input type="time" className="input !w-auto" value={fin} onChange={(e) => setFin(e.target.value)} />
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="label">Jours de la semaine</legend>
            {DAY_LABELS.map((label, i) => (
              <label key={label} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={jours.has(i)}
                  onChange={(e) =>
                    setJours((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || !personId || jours.size === 0} onClick={ajouter}>
              {busy ? "Enregistrement…" : "Ajouter au planning"}
            </button>
            <button className="btn-secondary inline-flex items-center gap-1.5" disabled={busy} onClick={copierSemainePrecedente}>
              <IconCopy className="h-4 w-4" /> Copier la semaine précédente
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
