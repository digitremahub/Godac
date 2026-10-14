"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { PROVIDER_KIND_LABELS, type ProviderKind } from "@/lib/rental/workflow";
import { parseEmailList } from "@/lib/rental/schemas";

export interface ProviderRow {
  id: string;
  name: string;
  kind: ProviderKind;
  contact_name: string | null;
  maintenance_emails: string[];
  phone: string | null;
  contract_reference: string | null;
  notes: string | null;
  active: boolean;
  vehicles: string[];
}

interface Draft {
  name: string;
  kind: ProviderKind;
  contact_name: string;
  emails: string;
  phone: string;
  contract_reference: string;
  notes: string;
}

const EMPTY: Draft = { name: "", kind: "loueur", contact_name: "", emails: "", phone: "", contract_reference: "", notes: "" };

function toDraft(p: ProviderRow): Draft {
  return {
    name: p.name,
    kind: p.kind,
    contact_name: p.contact_name ?? "",
    emails: p.maintenance_emails.join(", "),
    phone: p.phone ?? "",
    contract_reference: p.contract_reference ?? "",
    notes: p.notes ?? "",
  };
}

export function RentalProvidersManager({ providers }: { providers: ProviderRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(id: string | "new") {
    setEditingId(id);
    setDraft(id === "new" ? EMPTY : toDraft(providers.find((p) => p.id === id)!));
    setError(null);
  }

  async function send(url: string, method: "POST" | "PATCH", body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible.");
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: draft.name,
      kind: draft.kind,
      contact_name: draft.contact_name,
      maintenance_emails: parseEmailList(draft.emails),
      phone: draft.phone,
      contract_reference: draft.contract_reference,
      notes: draft.notes,
    };
    if (editingId === "new") void send("/api/rental-providers", "POST", body);
    else if (editingId) void send(`/api/rental-providers/${editingId}`, "PATCH", body);
  }

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const form = (
    <Card>
      <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Nom *
          <input className="input mt-1" required maxLength={160} value={draft.name} onChange={set("name")} />
        </label>
        <label className="text-sm">
          Type
          <select className="input mt-1" value={draft.kind} onChange={set("kind")}>
            {Object.entries(PROVIDER_KIND_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Contact
          <input className="input mt-1" maxLength={160} value={draft.contact_name} onChange={set("contact_name")} />
        </label>
        <label className="text-sm">
          Téléphone
          <input className="input mt-1" type="tel" maxLength={40} value={draft.phone} onChange={set("phone")} />
        </label>
        <label className="text-sm sm:col-span-2">
          E-mail(s) pour les demandes d&apos;entretien (séparés par des virgules, 5 max.)
          <input className="input mt-1" value={draft.emails} onChange={set("emails")} placeholder="atelier@loueur.fr, service-client@loueur.fr" />
        </label>
        <label className="text-sm">
          Référence contrat cadre
          <input className="input mt-1" maxLength={120} value={draft.contract_reference} onChange={set("contract_reference")} />
        </label>
        <label className="text-sm sm:col-span-2">
          Notes
          <textarea className="input mt-1" rows={2} maxLength={2000} value={draft.notes} onChange={set("notes")} />
        </label>
        {error && <p role="alert" className="text-sm text-orange-ink sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={busy}>
            Enregistrer
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditingId(null)}>
            Annuler
          </button>
        </div>
      </form>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      {editingId === null && (
        <button className="btn-primary self-start" onClick={() => open("new")}>
          + Ajouter un loueur / prestataire
        </button>
      )}
      {editingId === "new" && form}
      {providers.length === 0 && editingId !== "new" ? (
        <EmptyState title="Aucun loueur ni prestataire" description="Ajoutez vos loueurs (LLD, location, crédit-bail) et les garages qui entretiennent vos véhicules loués." />
      ) : (
        providers.map((p) =>
          editingId === p.id ? (
            <div key={p.id}>{form}</div>
          ) : (
            <Card key={p.id} className={p.active ? "" : "opacity-60"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {p.name} <span className="badge-neutral ml-1">{PROVIDER_KIND_LABELS[p.kind]}</span>
                    {!p.active && <span className="badge-orange ml-1">Archivé</span>}
                  </p>
                  <p className="text-sm text-navy/70">{[p.contact_name, p.phone, p.contract_reference && `Contrat ${p.contract_reference}`].filter(Boolean).join(" · ") || "—"}</p>
                  <p className="text-sm text-navy/70">
                    {p.maintenance_emails.length ? p.maintenance_emails.join(", ") : <span className="text-orange-ink">Aucune adresse e-mail : les demandes ne pourront pas être envoyées automatiquement.</span>}
                  </p>
                  {p.vehicles.length > 0 && <p className="mt-1 text-xs text-navy/60">Véhicules : {p.vehicles.join(", ")}</p>}
                  {p.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-navy/60">{p.notes}</p>}
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy || editingId !== null} onClick={() => open(p.id)}>
                    Modifier
                  </button>
                  <button
                    className="btn-secondary !px-2 !py-1 text-xs"
                    disabled={busy || editingId !== null}
                    onClick={() => void send(`/api/rental-providers/${p.id}`, "PATCH", { active: !p.active })}
                  >
                    {p.active ? "Archiver" : "Réactiver"}
                  </button>
                </div>
              </div>
            </Card>
          ),
        )
      )}
      {error && editingId === null && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
    </div>
  );
}
