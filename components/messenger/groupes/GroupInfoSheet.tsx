"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconUsers, IconX } from "@/components/layout/icons";
import { confirmer } from "@/lib/ui/confirmation";

export interface GroupMemberView {
  id: string;
  full_name: string;
  role: "admin" | "member";
  chef: boolean;
}

/**
 * Fiche du groupe (bouton « Infos ») : membres et leurs rôles,
 * sourdine personnelle, et pour les responsables le mode « seuls les
 * responsables écrivent », le nom et les membres des groupes ponctuels.
 * La direction peut rejoindre / quitter un groupe.
 */
export function GroupInfoSheet({
  groupId,
  kind,
  name,
  serviceName,
  announcementOnly,
  members,
  isMember,
  joinedManually,
  muted,
  canAdmin,
  canJoin,
  addableMembers,
  currentUserId,
}: {
  groupId: string;
  kind: "team" | "custom";
  name: string;
  serviceName: string | null;
  announcementOnly: boolean;
  members: GroupMemberView[];
  isMember: boolean;
  joinedManually: boolean;
  muted: boolean;
  canAdmin: boolean;
  canJoin: boolean;
  /** Collègues de l'équipe qu'un responsable peut ajouter à un groupe ponctuel. */
  addableMembers: { id: string; full_name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toAdd, setToAdd] = useState("");

  async function patch(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/messenger/groupes/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      after?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function supprimer() {
    if (!(await confirmer({ titre: `Supprimer le groupe « ${name} » et tous ses messages ?`, message: "", action: "Supprimer", danger: true }))) return;
    setBusy(true);
    const res = await fetch(`/api/messenger/groupes/${groupId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.push("/communication/messenger");
    else setError("Suppression impossible.");
  }

  const memberIds = new Set(members.map((m) => m.id));
  const candidats = addableMembers.filter((m) => !memberIds.has(m.id));
  const custom = kind === "custom";

  return (
    <>
      <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <IconUsers className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Infos
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Infos du groupe ${name}`}
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-raised sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold">{name}</h2>
                <p className="text-xs text-navy/60">
                  {kind === "team" ? "Groupe d'équipe" : "Groupe ponctuel"}
                  {serviceName ? ` · ${serviceName}` : ""} · {members.length} membre{members.length > 1 ? "s" : ""}
                </p>
              </div>
              <button className="text-navy/60" onClick={() => setOpen(false)} aria-label="Fermer">
                <IconX className="h-5 w-5" />
              </button>
            </div>

            {error && <p role="alert" className="mt-2 text-sm text-orange-ink">{error}</p>}

            <div className="mt-3 flex flex-col gap-2 text-sm">
              {isMember && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={muted} disabled={busy} onChange={(e) => patch({ muted: e.target.checked })} />
                  Sourdine (plus de notification, sauf si on vous mentionne)
                </label>
              )}
              {canAdmin && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={announcementOnly}
                    disabled={busy}
                    onChange={(e) => patch({ announcement_only: e.target.checked })}
                  />
                  Seuls les responsables écrivent (les membres peuvent réagir)
                </label>
              )}
              {canAdmin && custom && (
                <label className="block">
                  <span className="label">Nom du groupe</span>
                  <input
                    className="input !py-1"
                    defaultValue={name}
                    maxLength={80}
                    disabled={busy}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== name && patch({ name: e.target.value.trim() })}
                  />
                </label>
              )}
              {kind === "team" && (
                <p className="text-xs text-navy/60">
                  Les membres suivent automatiquement le service : arrivée, départ ou désactivation d&apos;un compte mettent le groupe à jour.
                </p>
              )}
            </div>

            <h3 className="mt-4 text-sm font-semibold">Membres</h3>
            <ul className="mt-1 flex flex-col divide-y divide-navy/[0.06]">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="truncate">
                    {m.full_name}
                    {m.id === currentUserId ? " (vous)" : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {m.chef ? <span className="badge-gold">Chef d&apos;équipe</span> : m.role === "admin" && <span className="badge-teal">Responsable</span>}
                    {canAdmin && custom && m.id !== currentUserId && (
                      <button className="text-xs text-navy/60 underline" disabled={busy} onClick={() => patch({ remove_member_ids: [m.id] })}>
                        Retirer
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {canAdmin && custom && candidats.length > 0 && (
              <div className="mt-3 flex gap-2">
                <select className="input min-w-0 flex-1 !py-1" aria-label="Ajouter un membre" value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
                  <option value="">Ajouter un membre…</option>
                  {candidats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
                <button className="btn-secondary shrink-0 !py-1" disabled={busy || !toAdd} onClick={() => patch({ add_member_ids: [toAdd] }, () => setToAdd(""))}>
                  Ajouter
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {canJoin && !isMember && (
                <button className="btn-primary !py-1.5 text-sm" disabled={busy} onClick={() => patch({ join: true })}>
                  Rejoindre le groupe
                </button>
              )}
              {isMember && (custom || joinedManually) && (
                <button className="btn-secondary !py-1.5 text-sm" disabled={busy} onClick={() => patch({ leave: true }, () => setOpen(false))}>
                  Quitter le groupe
                </button>
              )}
              {canAdmin && custom && (
                <button className="btn-danger !py-1.5 text-sm" disabled={busy} onClick={supprimer}>
                  Supprimer le groupe
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
