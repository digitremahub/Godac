"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface TankPhotoRow {
  id: string;
  tankName: string;
  submittedByName: string;
  totalizerReading: number | null;
  note: string | null;
  status: "pending_review" | "reviewed";
  createdAt: string;
  photoUrl: string | null;
}

export function TankPhotosTable({ photos, canReview }: { photos: TankPhotoRow[]; canReview: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reading, setReading] = useState("");
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startEdit(photo: TankPhotoRow) {
    setEditingId(photo.id);
    setReading(photo.totalizerReading?.toString() ?? "");
    setNote(photo.note ?? "");
    setError(null);
  }

  async function saveEdit(id: string, markReviewed: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/tank-photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalizer_reading: reading ? Number(reading) : null,
          note: note || null,
          ...(markReviewed ? { status: "reviewed" } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  if (photos.length === 0) {
    return <EmptyState title="Aucune photo de cuve" description="Les photos envoyées depuis la page Cuves apparaîtront ici." />;
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p role="alert" className="mb-3 text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[760px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Cuve</th>
            <th className="pb-2">Envoyée par</th>
            <th className="pb-2">Date</th>
            <th className="pb-2">Photo</th>
            <th className="pb-2">Index lu</th>
            <th className="pb-2">Note</th>
            <th className="pb-2">Statut</th>
            {canReview && <th className="pb-2"></th>}
          </tr>
        </thead>
        <tbody>
          {photos.map((p) => {
            const isEditing = editingId === p.id;
            return (
              <tr key={p.id} className="border-t border-navy/5 align-top">
                <td className="py-2">{p.tankName}</td>
                <td className="py-2">{p.submittedByName}</td>
                <td className="py-2">{new Date(p.createdAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                <td className="py-2">
                  {p.photoUrl ? (
                    <a href={p.photoUrl} target="_blank" rel="noreferrer" className="text-teal-ink hover:underline">
                      Voir
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2">
                  {isEditing ? (
                    <input aria-label="Index lu (L)" className="input !w-24 !py-1" type="number" value={reading} onChange={(e) => setReading(e.target.value)} />
                  ) : (
                    p.totalizerReading != null ? `${p.totalizerReading.toLocaleString("fr-FR")} L` : "—"
                  )}
                </td>
                <td className="py-2 text-navy/70">
                  {isEditing ? (
                    <input aria-label="Note" className="input !py-1" value={note} onChange={(e) => setNote(e.target.value)} />
                  ) : (
                    p.note ?? "—"
                  )}
                </td>
                <td className="py-2">
                  <span className={p.status === "reviewed" ? "badge-teal" : "badge-gold"}>
                    {p.status === "reviewed" ? "Vérifiée" : "À vérifier"}
                  </span>
                </td>
                {canReview && (
                  <td className="py-2">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <button className="btn-primary !px-2 !py-1 text-xs" disabled={busyId === p.id} onClick={() => saveEdit(p.id, true)}>
                          Enregistrer et vérifier
                        </button>
                        <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busyId === p.id} onClick={() => saveEdit(p.id, false)}>
                          Enregistrer
                        </button>
                        <button className="text-xs text-navy/60" disabled={busyId === p.id} onClick={() => setEditingId(null)}>
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => startEdit(p)}>
                        Modifier
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
