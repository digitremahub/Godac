"use client";

import { useId } from "react";
import { LIBELLES_STATUT, estStatutUnite } from "@/lib/stock/transitions";

/** Appel d'une route /api/stock : renvoie les données ou le message d'erreur en français. */
export type ReponseApi<T> = { ok: true; data: T } | { ok: false; erreur: string; reseau: boolean };

export async function appeler<T = Record<string, unknown>>(url: string, init?: { method?: string; corps?: unknown }): Promise<ReponseApi<T>> {
  try {
    const r = await fetch(url, {
      method: init?.method ?? (init?.corps === undefined ? "GET" : "POST"),
      headers: init?.corps === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.corps === undefined ? undefined : JSON.stringify(init.corps),
    });
    const json = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) return { ok: false, erreur: json.error ?? "Enregistrement impossible, réessayez.", reseau: false };
    return { ok: true, data: json };
  } catch {
    return { ok: false, erreur: "Pas de connexion : réessayez dans un instant (l'action ne sera pas enregistrée en double).", reseau: true };
  }
}

const CLASSE_STATUT: Record<string, string> = {
  dans_depot: "badge-teal",
  en_tournee: "badge-gold",
  livre: "badge-neutral",
  retour: "badge-orange",
  perdu: "badge-orange",
  endommage: "badge-orange",
};

export function BadgeStatut({ statut }: { statut: string }) {
  return <span className={CLASSE_STATUT[statut] ?? "badge-neutral"}>{estStatutUnite(statut) ? LIBELLES_STATUT[statut] : statut}</span>;
}

/** Choix unique présenté en pastilles (boutons radio natifs : clavier et lecteurs d'écran). */
export function Choix<T extends string>({
  legende,
  valeur,
  options,
  onChange,
  aide,
}: {
  legende: string;
  valeur: T;
  options: readonly { valeur: T; libelle: string }[];
  onChange: (v: T) => void;
  aide?: string;
}) {
  const nom = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="label">{legende}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.valeur} className="relative">
            <input type="radio" name={nom} value={o.valeur} checked={valeur === o.valeur} onChange={() => onChange(o.valeur)} className="peer sr-only" />
            <span className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-navy/[0.14] bg-surface px-3.5 text-sm font-semibold text-navy transition-colors hover:border-navy/25 peer-checked:border-teal-ink peer-checked:bg-teal/10 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-ink">
              {o.libelle}
            </span>
          </label>
        ))}
      </div>
      {aide && <p className="mt-1.5 text-xs text-navy/65">{aide}</p>}
    </fieldset>
  );
}

export function Champ({ libelle, aide, children }: { libelle: string; aide?: string; children: (id: string, aideId: string | undefined) => React.ReactNode }) {
  const id = useId();
  const aideId = aide ? `${id}-aide` : undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">
        {libelle}
      </label>
      {children(id, aideId)}
      {aide && (
        <p id={aideId} className="mt-1.5 text-xs text-navy/65">
          {aide}
        </p>
      )}
    </div>
  );
}

/** Message d'état annoncé aux lecteurs d'écran (succès : poli ; erreur : assertif). */
export function Message({ message, erreur }: { message: string | null; erreur?: boolean }) {
  if (!message) return null;
  return (
    <p role={erreur ? "alert" : "status"} className={`rounded-xl px-3.5 py-2.5 text-sm font-medium ${erreur ? "bg-orange/[0.12] text-orange-ink" : "bg-teal/[0.12] text-teal-ink"}`}>
      {message}
    </p>
  );
}
