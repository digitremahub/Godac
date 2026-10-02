"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Row {
  id: string;
  question: string;
  status: "open" | "in_progress" | "resolved";
  createdAt: string;
  organizationName: string;
}

const STATUS_LABELS: Record<string, string> = { open: "Ouverte", in_progress: "Prise en charge", resolved: "Résolue" };

/** GODAC staff side of a `support_godac`-routed request (direction reporting a bug/question about GODAC itself). */
export function StaffSupportRequestsList({ requests }: { requests: Row[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function respond(id: string) {
    const response = drafts[id]?.trim();
    if (!response) return;
    setBusyId(id);
    try {
      await fetch(`/api/godac-staff/support-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved", response }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) return <p className="text-sm text-navy/40">Aucune demande transmise au support GODAC.</p>;

  return (
    <div className="flex flex-col gap-2">
      {requests.map((r) => (
        <div key={r.id} className="rounded-lg border border-navy/10 p-3 text-sm">
          <p className="text-navy/50">
            {r.organizationName} · {new Date(r.createdAt).toLocaleString("fr-FR")} · {STATUS_LABELS[r.status]}
          </p>
          <p className="mb-2">{r.question}</p>
          {r.status !== "resolved" && (
            <div className="flex gap-2">
              <input
                className="input !py-1 text-xs"
                placeholder="Réponse…"
                value={drafts[r.id] ?? ""}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
              />
              <button
                className="btn-primary shrink-0 !px-2 !py-1 text-xs"
                disabled={busyId === r.id || !drafts[r.id]?.trim()}
                onClick={() => respond(r.id)}
              >
                Répondre
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
