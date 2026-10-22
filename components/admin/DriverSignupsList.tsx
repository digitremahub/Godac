"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { confirmer } from "@/lib/ui/confirmation";

interface SignupRequest {
  id: string;
  full_name: string;
  phone: string | null;
  created_at: string;
  user_services: { services: { name: string } | null }[];
}

export function DriverSignupsList({ requests }: { requests: SignupRequest[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    if (action === "reject" && !(await confirmer({ titre: "Refuser et supprimer cette demande ?", message: "", action: "Refuser", danger: true }))) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/driver-signups/${id}/${action}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {requests.map((r) => {
        const serviceNames = (r.user_services ?? []).map((us) => us.services?.name).filter(Boolean).join(", ");
        return (
          <Card key={r.id} className={`flex items-center justify-between gap-4 ${busyId === r.id ? "opacity-40" : ""}`}>
            <div>
              <p className="font-medium">{r.full_name}</p>
              <p className="text-sm text-navy/65">
                {r.phone ?? "Pas de téléphone"} · {serviceNames || "Aucun service choisi"}
              </p>
              <p className="text-xs text-navy/60">
                Inscrit le {new Date(r.created_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={busyId === r.id} onClick={() => act(r.id, "reject")}>
                Refuser
              </button>
              <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={busyId === r.id} onClick={() => act(r.id, "approve")}>
                Approuver
              </button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
