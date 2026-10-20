"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconTrash } from "@/components/layout/icons";

export interface MessageRow {
  id: string;
  sender_id: string;
  body: string | null;
  photoUrl: string | null;
  created_at: string;
}

/**
 * The bubble list for a conversation — shared by the full /communication/messenger
 * page (server-rendered data, router.refresh() on change) and the
 * floating widget (client-fetched data, an onChanged refetch callback
 * instead), so delete/photo rendering logic only lives in one place.
 */
export function MessageThread({
  messages,
  currentUserId,
  onChanged,
}: {
  messages: MessageRow[];
  currentUserId: string;
  /** Floating widget context: refetch the thread instead of a full page router.refresh(). */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function del(id: string) {
    if (!confirm("Supprimer ce message ?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/messenger/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      }
      if (onChanged) onChanged();
      else router.refresh();
    } catch {
      // Best-effort — a failed delete just leaves the message in place.
    } finally {
      setBusyId(null);
    }
  }

  if (messages.length === 0) {
    return <p className="text-xs text-navy/60">Aucun message échangé pour l&apos;instant.</p>;
  }

  return (
    <>
      {messages.map((m) => (
        <div key={m.id} className={`flex ${m.sender_id === currentUserId ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[75%] rounded-xl px-3 py-1.5 text-sm ${m.sender_id === currentUserId ? "bg-teal/15" : "bg-navy/[0.04]"}`}>
            {m.photoUrl && (
              <a href={m.photoUrl} target="_blank" rel="noreferrer">
                <img loading="lazy" src={m.photoUrl} alt="Photo envoyée" className="mb-1 max-h-64 max-w-full rounded-lg object-contain" />
              </a>
            )}
            {m.body && <p>{m.body}</p>}
            <div className="mt-0.5 flex items-center justify-end gap-1.5">
              {m.sender_id === currentUserId && (
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
              <p className="text-xs text-navy/60">
                {new Date(m.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
