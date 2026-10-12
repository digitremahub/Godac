"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface ServiceOption {
  id: string;
  name: string;
}

type QualificationStatus = "titulaire" | "formation" | "remplacement";

const STATUS_LABELS: Record<QualificationStatus, string> = {
  titulaire: "Titulaire",
  formation: "Formation",
  remplacement: "Remplacement",
};

/**
 * Replaces the admin table's "one service per driver" quick-edit with
 * the real shape: a driver can be qualified on several services at
 * once ("formé à plusieurs services"), each at its own level. Direction-
 * only (matches the "user_services: direction manages" RLS policy) —
 * only rendered on the driver's fiche when appUser.role === 'direction'.
 */
export function DriverServicesPanel({
  userId,
  services,
  initialAssignments,
}: {
  userId: string;
  services: ServiceOption[];
  initialAssignments: { service_id: string; status: QualificationStatus }[];
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Map<string, QualificationStatus>>(
    new Map(initialAssignments.map((a) => [a.service_id, a.status])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(serviceId: string, checked: boolean) {
    setSaved(false);
    setAssignments((prev) => {
      const next = new Map(prev);
      if (checked) next.set(serviceId, next.get(serviceId) ?? "titulaire");
      else next.delete(serviceId);
      return next;
    });
  }

  function setStatus(serviceId: string, status: QualificationStatus) {
    setSaved(false);
    setAssignments((prev) => new Map(prev).set(serviceId, status));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          services: Array.from(assignments.entries()).map(([service_id, status]) => ({ service_id, status })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm font-medium">Services qualifiés</p>
      <p className="text-xs text-navy/60">
        Un chauffeur peut être formé sur plusieurs services à la fois — cochez chacun et précisez son niveau.
      </p>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      <div className="flex flex-col gap-2">
        {services.map((s) => {
          const status = assignments.get(s.id);
          return (
            <div key={s.id} className="flex items-center gap-3">
              <label className="flex min-h-[32px] flex-1 items-center gap-2 text-sm">
                <input type="checkbox" checked={status !== undefined} onChange={(e) => toggle(s.id, e.target.checked)} />
                {s.name}
              </label>
              {status !== undefined && (
                <select aria-label={`Statut de qualification — ${s.name}`}
                  className="input !w-auto !py-1 text-sm"
                  value={status}
                  onChange={(e) => setStatus(s.id, e.target.value as QualificationStatus)}
                >
                  {(Object.keys(STATUS_LABELS) as QualificationStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
        {services.length === 0 && <p className="text-xs text-navy/60">Aucun service dans l&apos;organisation.</p>}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary !px-3 !py-1.5 text-sm" disabled={busy} onClick={save}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && <span role="status" className="text-sm text-teal-ink">Enregistré.</span>}
      </div>
    </Card>
  );
}
