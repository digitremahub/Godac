"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconPlusCircle, IconX } from "@/components/layout/icons";

export interface TeamOption {
  /** null = groupe transversal (direction). */
  service_id: string | null;
  label: string;
  members: { id: string; full_name: string }[];
}

/** « Créer un groupe » — chef d'équipe, managers et direction, avec des membres de leur équipe. */
export function CreateGroupButton({ teams, currentUserId }: { teams: TeamOption[]; currentUserId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teamIdx, setTeamIdx] = useState(0);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const team = teams[teamIdx];
  const candidats = (team?.members ?? []).filter((m) => m.id !== currentUserId);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (!team) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/messenger/groupes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), service_id: team.service_id, member_ids: Array.from(selected) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setOpen(false);
      setName("");
      setSelected(new Set());
      router.push(`/communication/messenger?groupe=${json.groupId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (teams.length === 0) return null;

  return (
    <>
      <button className="btn-primary w-full !py-1.5 text-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <IconPlusCircle className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Créer un groupe
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Créer un groupe"
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-raised sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Créer un groupe</h2>
              <button className="text-navy/60" onClick={() => setOpen(false)} aria-label="Fermer">
                <IconX className="h-5 w-5" />
              </button>
            </div>
            {error && <p role="alert" className="mt-2 text-sm text-orange-ink">{error}</p>}
            <div className="mt-3 flex flex-col gap-3">
              <label className="block">
                <span className="label">Nom</span>
                <input className="input" placeholder="ex : Équipe matin" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              {teams.length > 1 && (
                <label className="block">
                  <span className="label">Équipe</span>
                  <select
                    className="input"
                    value={teamIdx}
                    onChange={(e) => {
                      setTeamIdx(Number(e.target.value));
                      setSelected(new Set());
                    }}
                  >
                    {teams.map((t, i) => (
                      <option key={t.service_id ?? "transversal"} value={i}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <fieldset>
                <legend className="label">
                  Membres ({selected.size} sélectionné{selected.size > 1 ? "s" : ""})
                </legend>
                {candidats.length === 0 ? (
                  <p className="text-sm text-navy/60">Personne d&apos;autre dans cette équipe.</p>
                ) : (
                  <div className="mt-1 flex max-h-64 flex-col gap-1 overflow-y-auto">
                    <button
                      type="button"
                      className="self-start text-xs text-teal-ink underline"
                      onClick={() => setSelected(selected.size === candidats.length ? new Set() : new Set(candidats.map((c) => c.id)))}
                    >
                      {selected.size === candidats.length ? "Tout désélectionner" : "Tout sélectionner"}
                    </button>
                    {candidats.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-navy/[0.04]">
                        <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                        {m.full_name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <button className="btn-primary" disabled={busy || !name.trim() || selected.size === 0} onClick={create}>
                {busy ? "…" : "Créer le groupe"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
