"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface SupportRequestRow {
  id: string;
  question: string;
  conversationSummary: string | null;
  recipient: "gestionnaire" | "support_godac";
  status: "open" | "in_progress" | "resolved";
  response: string | null;
  createdAt: string;
  requesterName: string;
}

const STATUS_LABELS: Record<string, string> = { open: "Ouverte", in_progress: "Prise en charge", resolved: "Résolue" };
const STATUS_BADGES: Record<string, string> = { open: "badge-gold", in_progress: "badge-neutral", resolved: "badge-teal" };

export function SupportRequestsList({ requests, canAddToNotes }: { requests: SupportRequestRow[]; canAddToNotes: boolean }) {
  const router = useRouter();
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function takeInCharge(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/support-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      });
      if (!res.ok) throw new Error("Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  async function respond(id: string) {
    const response = responseDrafts[id]?.trim();
    if (!response) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/support-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved", response }),
      });
      if (!res.ok) throw new Error("Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  async function addToNotes(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/support-requests/${id}/add-to-notes`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return <EmptyState title="Aucune demande" description="Les demandes transmises par l'assistant apparaîtront ici." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {requests.map((r) => (
        <Card key={r.id} className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-navy/65">
                {r.requesterName} · {new Date(r.createdAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
                {r.recipient === "support_godac" && " · transmis au support GODAC"}
              </p>
              <p>{r.question}</p>
            </div>
            <span className={STATUS_BADGES[r.status]}>{STATUS_LABELS[r.status]}</span>
          </div>
          {r.conversationSummary && <p className="rounded-lg bg-navy/[0.04] p-2 text-xs text-navy/70">{r.conversationSummary}</p>}
          {r.response ? (
            <div className="rounded-lg bg-teal/10 p-2 text-sm">
              <p className="mb-1 text-xs text-navy/65">Réponse envoyée</p>
              <p>{r.response}</p>
              {canAddToNotes && (
                <button className="mt-2 text-xs text-teal-ink underline" disabled={busyId === r.id} onClick={() => addToNotes(r.id)}>
                  Ajouter cette réponse aux consignes
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {r.status === "open" && (
                <button className="btn-secondary self-start !px-3 !py-1.5 text-xs" disabled={busyId === r.id} onClick={() => takeInCharge(r.id)}>
                  Prendre en charge
                </button>
              )}
              <textarea
                className="input"
                rows={2}
                aria-label="Ta réponse" placeholder="Ta réponse…"
                value={responseDrafts[r.id] ?? ""}
                onChange={(e) => setResponseDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
              />
              <button
                className="btn-primary self-start !px-3 !py-1.5 text-xs"
                disabled={busyId === r.id || !responseDrafts[r.id]?.trim()}
                onClick={() => respond(r.id)}
              >
                Répondre et clôturer
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
