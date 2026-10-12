"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { IconFileText, IconExternal } from "@/components/layout/icons";
import { expiryStatus, type VehicleDocument } from "@/lib/vehicles/document-types";

/**
 * Driver side of « Papiers du véhicule », on the scanned-vehicle page:
 * every document the exploitation marked consultable opens right away
 * (roadside check), and anything else can be asked for — the request
 * becomes an alert for the vehicle's managers.
 */
export function VehiclePapersCard({ vehicleId, documents, today }: { vehicleId: string; documents: VehicleDocument[]; today: string }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/document-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Envoi impossible.");
      setSent(true);
      setAsking(false);
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <h2>Papiers du véhicule</h2>
      {documents.length === 0 ? (
        <p className="mt-1 text-sm text-navy/65">Aucun document consultable pour ce véhicule.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {documents.map((doc) => {
            const status = expiryStatus(doc.expiresOn, today);
            return (
              <li key={doc.id}>
                <a
                  href={doc.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-[52px] items-center gap-3 rounded-xl border border-navy/[0.1] bg-surface px-4 py-2 hover:border-navy/20"
                >
                  <IconFileText className="h-5 w-5 shrink-0 text-teal-ink" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{doc.docType}</span>
                    {status === "expired" && <span className="block text-xs font-semibold text-orange-ink">Expiré — prévenez l&apos;exploitation</span>}
                    {status === "soon" && <span className="block text-xs text-gold-ink">Expire bientôt</span>}
                  </span>
                  <IconExternal className="h-4 w-4 shrink-0 text-navy/50" />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {sent && (
        <p role="status" className="mt-3 text-sm text-teal-ink">
          Demande envoyée à l&apos;exploitation.
        </p>
      )}
      {asking ? (
        <form onSubmit={request} className="mt-4 flex flex-col gap-3">
          <label className="block">
            <span className="label">Quel document ? (optionnel)</span>
            <input
              className="input"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex. assurance pour un contrôle routier…"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-orange-ink">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1" disabled={busy}>
              {busy ? "Envoi…" : "Envoyer la demande"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-ghost mt-3 w-full" onClick={() => setAsking(true)}>
          Demander un autre document
        </button>
      )}
    </Card>
  );
}
