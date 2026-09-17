"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface ServiceRow {
  id: string;
  name: string;
  code: string | null;
}

export function ServicesPanel({ services }: { services: ServiceRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addService() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code: code || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setName("");
      setCode("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function renameService(id: string, newName: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/services/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function deleteService(id: string) {
    if (!confirm("Supprimer ce service ? Les véhicules/cuves rattachés deviendront non assignés.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/services/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h3 className="text-lg">Services</h3>
      {error && <p className="text-sm text-orange-ink">{error}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label">Nom</label>
          <input className="input" placeholder="ex: Longue distance" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-32">
          <label className="label">Code</label>
          <input className="input" placeholder="ex: LD" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <button className="btn-primary shrink-0" disabled={busy || !name} onClick={addService}>
          Ajouter
        </button>
      </div>

      {services.length === 0 ? (
        <p className="text-sm text-navy/40">Aucun service configuré.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg bg-navy/5 px-3 py-2">
              <input
                className="input flex-1 !py-1"
                defaultValue={s.name}
                onBlur={(e) => e.target.value !== s.name && renameService(s.id, e.target.value)}
                disabled={busy}
              />
              <span className="w-16 text-sm text-navy/40">{s.code ?? "—"}</span>
              <button className="btn-danger !px-2 !py-1 text-xs" disabled={busy} onClick={() => deleteService(s.id)}>
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
