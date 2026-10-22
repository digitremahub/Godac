"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconFileText, IconPin, IconTrash } from "@/components/layout/icons";
import { REACTIONS } from "@/lib/messenger/groupes";
import { confirmer } from "@/lib/ui/confirmation";

export interface GroupMessageView {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string | null;
  attachmentUrl: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  is_announcement: boolean;
  pinned: boolean;
  created_at: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
}

export interface PinnedView {
  id: string;
  sender_name: string;
  body: string | null;
  attachmentUrl: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
  vuParLibelle: string;
  lecteurs: string[];
  nonLus: string[];
}

const dateCourte = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function PieceJointe({ url, name, type }: { url: string; name: string | null; type: string | null }) {
  if (type?.startsWith("image/") || (!type && !name)) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img loading="lazy" src={url} alt={name ?? "Photo envoyée"} className="mb-1 max-h-64 max-w-full rounded-lg object-contain" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-2 text-sm text-teal-ink underline">
      <IconFileText className="h-4 w-4 shrink-0" />
      <span className="truncate">{name ?? "Document"}</span>
    </a>
  );
}

/** Corps du message avec les @mentions mises en valeur. */
function Corps({ body }: { body: string }) {
  const parts = body.split(/(@[\p{L}][\p{L}\p{N}'-]*)/u);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => (p.startsWith("@") ? <strong key={i} className="text-teal-ink">{p}</strong> : <span key={i}>{p}</span>))}
    </p>
  );
}

async function patch(groupId: string, messageId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/messenger/groupes/${groupId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(typeof json.error === "string" ? json.error : "Erreur");
  }
}

/** Infos équipe épinglées, en haut du groupe, avec « vu par X/Y ». */
export function PinnedAnnouncements({ groupId, pinned, canAdmin }: { groupId: string; pinned: PinnedView[]; canAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (pinned.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {pinned.map((p) => (
        <div key={p.id} className="rounded-xl border border-gold/40 bg-gold/[0.12] px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="badge-gold">
              <IconPin className="inline-block h-3.5 w-3.5 shrink-0 align-[-0.2em]" /> Info équipe
            </span>
            <span className="text-xs text-navy/60">
              {p.sender_name} · {dateCourte(p.created_at)}
            </span>
          </div>
          <div className="mt-1.5">
            {p.attachmentUrl && <PieceJointe url={p.attachmentUrl} name={p.attachment_name} type={p.attachment_type} />}
            {p.body && <Corps body={p.body} />}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <details className="text-xs text-navy/70">
              <summary className="cursor-pointer">{p.vuParLibelle}</summary>
              <p className="mt-1">
                <strong>Vu :</strong> {p.lecteurs.length ? p.lecteurs.join(", ") : "personne pour l'instant"}
              </p>
              {p.nonLus.length > 0 && (
                <p className="mt-0.5">
                  <strong>Pas encore vu :</strong> {p.nonLus.join(", ")}
                </p>
              )}
            </details>
            {canAdmin && (
              <button
                className="text-xs text-navy/60 underline"
                disabled={busy === p.id}
                onClick={async () => {
                  setBusy(p.id);
                  try {
                    await patch(groupId, p.id, { pinned: false });
                    router.refresh();
                  } catch {
                    // Sans effet : l'info reste épinglée.
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Désépingler
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GroupThread({
  groupId,
  messages,
  currentUserId,
  canAdmin,
  canReact,
}: {
  groupId: string;
  messages: GroupMessageView[];
  currentUserId: string;
  canAdmin: boolean;
  canReact: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function del(id: string) {
    if (!(await confirmer({ titre: "Supprimer ce message pour tout le groupe ?", message: "", action: "Supprimer", danger: true }))) return;
    await act(id, async () => {
      const res = await fetch(`/api/messenger/groupes/${groupId}/messages/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Suppression impossible.");
    });
  }

  if (messages.length === 0) {
    return <p className="text-xs text-navy/60">Aucun message dans ce groupe pour l&apos;instant.</p>;
  }

  return (
    <>
      {messages.map((m) => {
        const mine = m.sender_id === currentUserId;
        return (
          <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-1.5 text-sm sm:max-w-[75%] ${
                m.is_announcement ? "border border-gold/40 bg-gold/[0.12]" : mine ? "bg-teal/15" : "bg-navy/[0.04]"
              }`}
            >
              {!mine && <p className="text-xs font-semibold text-navy/70">{m.sender_name}</p>}
              {m.is_announcement && (
                <p className="text-xs font-semibold text-gold-ink">
                  <IconPin className="inline-block h-3.5 w-3.5 shrink-0 align-[-0.2em]" /> Info équipe
                </p>
              )}
              {m.attachmentUrl && <PieceJointe url={m.attachmentUrl} name={m.attachment_name} type={m.attachment_type} />}
              {m.body && <Corps body={m.body} />}
              {m.reactions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      className={`rounded-full px-1.5 text-xs ${r.mine ? "bg-teal/20" : "bg-white/70"}`}
                      disabled={!canReact || busyId === m.id}
                      onClick={() => act(m.id, () => patch(groupId, m.id, { reaction: r.emoji }))}
                      aria-label={`Réaction ${r.emoji}, ${r.count}`}
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                </div>
              )}
              {pickerFor === m.id && (
                <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Choisir une réaction">
                  {REACTIONS.map((e) => (
                    <button
                      key={e}
                      className="rounded-full bg-white px-1.5 py-0.5 text-base"
                      disabled={busyId === m.id}
                      onClick={() => {
                        setPickerFor(null);
                        act(m.id, () => patch(groupId, m.id, { reaction: e }));
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-0.5 flex items-center justify-end gap-2">
                {canReact && (
                  <button className="text-xs text-navy/60" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} aria-label="Réagir">
                    🙂+
                  </button>
                )}
                {canAdmin && !m.pinned && (
                  <button
                    className="text-xs text-navy/60 hover:text-gold-ink"
                    disabled={busyId === m.id}
                    onClick={() => act(m.id, () => patch(groupId, m.id, { pinned: true }))}
                    title="Épingler"
                    aria-label="Épingler le message"
                  >
                    <IconPin className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" />
                  </button>
                )}
                {(mine || canAdmin) && (
                  <button
                    className="text-xs text-navy/60 hover:text-orange-ink"
                    disabled={busyId === m.id}
                    onClick={() => del(m.id)}
                    title="Supprimer"
                    aria-label="Supprimer le message"
                  >
                    <IconTrash className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" />
                  </button>
                )}
                <p className="text-xs text-navy/60">{dateCourte(m.created_at)}</p>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
