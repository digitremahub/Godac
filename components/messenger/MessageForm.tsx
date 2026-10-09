"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MessageForm({ recipientId }: { recipientId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/messenger/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: recipientId, body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setBody("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="text-xs text-orange-ink">{error}</p>}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Votre message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          disabled={busy}
        />
        <button className="btn-primary shrink-0" disabled={busy || !body.trim()} onClick={send}>
          Envoyer
        </button>
      </div>
    </div>
  );
}
