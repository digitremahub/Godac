"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { PLANS } from "@/lib/stripe/plans";

const STATUS_LABELS: Record<string, string> = {
  trialing: "Période d'essai",
  active: "Actif",
  past_due: "Paiement en retard",
  canceled: "Résilié",
  incomplete: "Incomplet",
};

export function BillingPanel({ plan, status, hasStripeCustomer }: { plan: string; status: string; hasStripeCustomer: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  async function choosePlan(planId: "starter" | "pro") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center justify-between">
        <div>
          <p className="text-sm text-navy/65">Plan actuel</p>
          <p className="text-xl capitalize">{plan}</p>
          <span className="badge-neutral mt-1">{STATUS_LABELS[status] ?? status}</span>
        </div>
        {hasStripeCustomer && (
          <button className="btn-secondary" disabled={busy} onClick={openPortal}>
            Gérer l&apos;abonnement
          </button>
        )}
      </Card>

      {error && <p className="text-sm text-orange-ink">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PLANS.map((p) => (
          <Card key={p.id} className="flex flex-col gap-3">
            <h3 className="text-lg">{p.name}</h3>
            <p className="text-sm text-navy/70">{p.description}</p>
            <button
              className={p.id === plan ? "btn-secondary" : "btn-primary"}
              disabled={busy || p.id === plan}
              onClick={() => choosePlan(p.id)}
            >
              {p.id === plan ? "Plan actuel" : `Passer à ${p.name}`}
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}
