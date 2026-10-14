"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { IconMapPin, IconNavigation } from "@/components/layout/icons";
import { PoleIcon } from "@/components/shared/PoleBadge";
import { POLES_BUREAU, poleDe } from "@/lib/organization/poles";

interface ServiceRow {
  id: string;
  name: string;
  code: string | null;
  depot_address: string | null;
  team_leader_name: string | null;
  team_leader_phone: string | null;
  team_leader_email: string | null;
  pole?: string | null;
  /** Noms des personnes rattachées (user_services) — affichés sous chaque pôle bureau. */
  members?: string[];
}

/**
 * Services groupés par pôle (lib/organization/poles.ts) : les services
 * transport sous « Exploitation », entièrement modifiables ; puis les
 * pôles bureau, présents dans toute entreprise — renommables, jamais
 * supprimables (refus côté API aussi).
 */
export function ServicesPanel({ services }: { services: ServiceRow[] }) {
  const exploitation = services.filter((s) => poleDe(s.pole).operationnel);
  const bureaux = POLES_BUREAU.map((pole) => ({ pole, services: services.filter((s) => s.pole === pole.key) }));
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

  async function updateDepotAddress(id: string, depotAddress: string) {
    await patchService(id, { depot_address: depotAddress || null });
  }

  async function patchService(id: string, patch: Record<string, string | null>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/services/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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
    <>
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="flex items-center gap-2 text-lg">
          <PoleIcon pole="exploitation" className="h-5 w-5 text-teal-ink" /> Exploitation — services transport
        </h3>
        <p className="text-sm text-navy/65">Chaque service a son dépôt, ses tournées, ses chauffeurs et ses véhicules.</p>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block"><span className="label">Nom</span>
          <input className="input" placeholder="ex: Longue distance" value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
        <div className="w-32">
          <label className="block"><span className="label">Code</span>
          <input className="input" placeholder="ex: LD" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        </div>
        <button className="btn-primary shrink-0" disabled={busy || !name} onClick={addService}>
          Ajouter
        </button>
      </div>

      {exploitation.length === 0 ? (
        <p className="text-sm text-navy/60">Aucun service configuré.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {exploitation.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
              <div className="flex items-center gap-3">
                <input aria-label="Nom du service"
                  className="input flex-1 !py-1"
                  defaultValue={s.name}
                  onBlur={(e) => e.target.value !== s.name && renameService(s.id, e.target.value)}
                  disabled={busy}
                />
                <span className="w-16 text-sm text-navy/60">{s.code ?? "—"}</span>
                <button className="btn-danger !px-2 !py-1 text-xs" disabled={busy} onClick={() => deleteService(s.id)}>
                  Supprimer
                </button>
              </div>
              <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <legend className="label">Chef d&apos;équipe (affiché à chaque chauffeur du service)</legend>
                {([
                  ["team_leader_name", "Nom", "ex : Karim B.", "text"],
                  ["team_leader_phone", "Téléphone", "06 12 34 56 78", "tel"],
                  ["team_leader_email", "E-mail", "chef@entreprise.fr", "email"],
                ] as const).map(([field, label, placeholder, type]) => (
                  <label key={field} className="block">
                    <span className="sr-only">{label}</span>
                    <input
                      className="input !py-1"
                      type={type}
                      aria-label={`${label} du chef d'équipe`}
                      placeholder={`${label} — ${placeholder}`}
                      defaultValue={s[field] ?? ""}
                      onBlur={(e) => e.target.value.trim() !== (s[field] ?? "") && patchService(s.id, { [field]: e.target.value.trim() || null })}
                      disabled={busy}
                    />
                  </label>
                ))}
              </fieldset>
              <div>
                <label className="block"><span className="label">Adresse du dépôt de ce service</span>
                <input
                  className="input !py-1"
                  placeholder="ex: 1 rue du Dépôt, 69007 Lyon — laissez vide pour utiliser le dépôt de l'organisation"
                  defaultValue={s.depot_address ?? ""}
                  onBlur={(e) => e.target.value !== (s.depot_address ?? "") && updateDepotAddress(s.id, e.target.value)}
                  disabled={busy}
                /></label>
                {s.depot_address && (
                  <p className="mt-1 flex gap-3 text-sm">
                    <a
                      href={`https://www.google.com/maps?q=${encodeURIComponent(s.depot_address)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal-ink underline"
                    >
                      <IconMapPin className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Google Maps
                    </a>
                    <a
                      href={`https://waze.com/ul?q=${encodeURIComponent(s.depot_address)}&navigate=yes`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal-ink underline"
                    >
                      <IconNavigation className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Waze
                    </a>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>

    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg">Pôles de l&apos;entreprise</h3>
        <p className="text-sm text-navy/65">
          Les mêmes pôles dans toutes les entreprises GODAC, pour les personnes des bureaux. Rattachez chaque personne à son pôle
          depuis sa fiche (Utilisateurs) ; son planning de présence se fait dans Planning en choisissant le pôle. Renommables,
          pas supprimables.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {bureaux.map(({ pole, services: lignes }) => (
          <li key={pole.key} className="flex flex-col gap-1.5 rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${pole.dotClass}`} aria-hidden="true" />
              <PoleIcon pole={pole.key} className="h-4 w-4 text-navy/60" />
              {pole.label}
            </p>
            {lignes.length === 0 && (
              <p className="text-xs text-navy/60">Pas encore créé — il le sera à la prochaine mise à jour de la base.</p>
            )}
            {lignes.map((s) => (
              <div key={s.id} className="flex flex-col gap-1">
                <input
                  aria-label={`Nom affiché du pôle ${pole.label}`}
                  className="input !py-1"
                  defaultValue={s.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && renameService(s.id, e.target.value.trim())}
                  disabled={busy}
                />
                <p className="text-xs text-navy/60">
                  {s.members && s.members.length > 0 ? s.members.join(", ") : "Personne de rattaché pour l'instant."}
                </p>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </Card>
    </>
  );
}
