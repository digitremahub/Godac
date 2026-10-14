"use client";

import { useState } from "react";
import { analyserIdentifiant, formaterSiret } from "@/lib/organization/siret";
import type { InfosEntreprise } from "@/lib/organization/recherche-entreprises";

/**
 * Champ SIRET/SIREN + bouton « Rechercher » : contrôle la clé de Luhn
 * dans le navigateur, puis lit la fiche publique de l'entreprise
 * (/api/entreprise/recherche). Si le répertoire ne répond pas, le
 * message le dit et la saisie manuelle reste possible — rien ne bloque.
 */
export function SiretLookup({
  value,
  onChange,
  onFound,
  label = "SIRET (ou SIREN)",
}: {
  value: string;
  onChange: (value: string) => void;
  onFound: (info: InfosEntreprise) => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analyse = value.trim() ? analyserIdentifiant(value) : null;

  async function rechercher() {
    if (!analyse || analyse.type === "invalide") {
      setError(analyse?.type === "invalide" ? analyse.raison : "Saisissez un SIRET (14 chiffres) ou un SIREN (9 chiffres).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/entreprise/recherche?q=${analyse.valeur}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Recherche impossible — vous pouvez saisir les informations à la main.");
      onChange(formaterSiret(json.entreprise.siret ?? json.entreprise.siren));
      onFound(json.entreprise as InfosEntreprise);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recherche impossible — vous pouvez saisir les informations à la main.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="label" htmlFor="siret-lookup">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="siret-lookup"
          className="input"
          inputMode="numeric"
          autoComplete="off"
          placeholder="ex: 804 467 967 00027"
          value={value}
          onChange={(e) => {
            setError(null);
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void rechercher();
            }
          }}
          aria-invalid={analyse?.type === "invalide" || undefined}
          aria-describedby="siret-lookup-aide"
        />
        <button type="button" className="btn-secondary shrink-0" disabled={busy || !value.trim()} onClick={rechercher}>
          {busy ? "Recherche…" : "Rechercher"}
        </button>
      </div>
      <p id="siret-lookup-aide" className="mt-1 text-sm text-navy/65">
        {analyse?.type === "invalide" && value.replace(/\D/g, "").length >= 9 ? (
          <span className="text-orange-ink">{analyse.raison}</span>
        ) : (
          "GODAC retrouve la raison sociale, l'adresse, l'activité et la convention collective dans le répertoire public des entreprises (INSEE)."
        )}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-orange-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/** Aperçu compact d'une fiche trouvée. */
export function ApercuEntreprise({ info }: { info: InfosEntreprise }) {
  const lignes: [string, string | null][] = [
    ["Raison sociale", info.raisonSociale ?? info.nom],
    ["Forme juridique", info.formeJuridique],
    ["Activité", info.codeNaf ? `${info.codeNaf}${info.libelleNaf ? ` — ${info.libelleNaf}` : ""}` : null],
    ["Siège", info.adresseSiege],
    ["Établissement", info.adresse !== info.adresseSiege ? info.adresse : null],
    ["Effectif", info.libelleEffectif],
    ["Convention(s)", info.idcc.length > 0 ? info.idcc.map((i) => `IDCC ${Number(i)}`).join(", ") : "aucune déclarée"],
  ];
  return (
    <div className="rounded-lg bg-navy/[0.04] p-3 text-sm">
      {info.cessee && <p className="mb-2 text-orange-ink">Attention : cette entreprise est déclarée cessée dans le répertoire.</p>}
      <dl className="grid gap-1">
        {lignes
          .filter((l): l is [string, string] => Boolean(l[1]))
          .map(([t, v]) => (
            <div key={t} className="flex gap-2">
              <dt className="w-32 shrink-0 text-navy/55">{t}</dt>
              <dd className="text-navy/85">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
