"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { datetimeLocalToIso } from "@/lib/utils/datetime-local";

type Action = "accepter" | "proposer_creneau" | "commenter" | "terminer";

const ACTIONS: { value: Action; label: string }[] = [
  { value: "accepter", label: "Accepter la demande" },
  { value: "proposer_creneau", label: "Proposer un créneau" },
  { value: "commenter", label: "Ajouter un commentaire" },
  { value: "terminer", label: "Intervention terminée" },
];

/** Formulaire de réponse du prestataire (page publique /prestataire/[token]). */
export function ProviderResponseForm({ token, status, accepted }: { token: string; status: string; accepted: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<Action>(accepted || status === "planifiee" ? "proposer_creneau" : "accepter");
  const [comment, setComment] = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [slotEnd, setSlotEnd] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.set("action", action);
      if (comment.trim()) fd.set("comment", comment.trim());
      const start = datetimeLocalToIso(slotStart);
      const end = datetimeLocalToIso(slotEnd);
      if (start && (action === "proposer_creneau" || action === "accepter")) fd.set("slot_start", start);
      if (end && (action === "proposer_creneau" || action === "accepter")) fd.set("slot_end", end);
      if (file) fd.set("file", file);
      const res = await fetch(`/api/public/prestataire/${encodeURIComponent(token)}`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Envoi impossible.");
      setDone("Réponse enregistrée, l'entreprise est prévenue.");
      setComment("");
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  const showSlot = action === "proposer_creneau" || action === "accepter";

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm font-semibold">Votre réponse</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type de réponse">
          {ACTIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={action === a.value}
              className={action === a.value ? "btn-primary !px-3 !py-1.5 text-sm" : "btn-secondary !px-3 !py-1.5 text-sm"}
              onClick={() => setAction(a.value)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {showSlot && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Début du créneau{action === "accepter" ? " (facultatif)" : ""}
              <input type="datetime-local" className="input mt-1" value={slotStart} onChange={(e) => setSlotStart(e.target.value)} required={action === "proposer_creneau"} />
            </label>
            <label className="text-sm">
              Fin (facultatif)
              <input type="datetime-local" className="input mt-1" value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} />
            </label>
          </div>
        )}
        <label className="text-sm">
          Commentaire{action === "commenter" ? "" : " (facultatif)"}
          <textarea className="input mt-1" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} required={action === "commenter"} />
        </label>
        {(action === "terminer" || action === "commenter") && (
          <label className="text-sm">
            Facture ou compte rendu (PDF, JPEG ou PNG, 10 Mo max.)
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="mt-1 block text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        {done && <p role="status" className="text-sm text-teal-ink">{done}</p>}
        <button type="submit" className="btn-primary self-start" disabled={busy}>
          {busy ? "Envoi…" : "Envoyer"}
        </button>
      </form>
    </Card>
  );
}
