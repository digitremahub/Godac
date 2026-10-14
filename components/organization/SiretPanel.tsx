"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { ApercuEntreprise, SiretLookup } from "@/components/organization/SiretLookup";
import { comparerFiche, LIBELLES_FICHE, type CleFiche } from "@/lib/organization/fiche-entreprise";
import { formaterSiret } from "@/lib/organization/siret";
import type { InfosEntreprise } from "@/lib/organization/recherche-entreprises";

/**
 * Organisation › Identité de l'entreprise : retrouve la fiche SIRENE
 * et montre, champ par champ, ce qui sera rempli (champs vides) et ce
 * qui remplacerait une valeur déjà saisie — décoché par défaut, rien
 * n'est écrasé sans que la direction le coche.
 */
export function SiretPanel({ actuel, verifieLe }: { actuel: Partial<Record<CleFiche, unknown>>; verifieLe: string | null }) {
  const router = useRouter();
  const [saisie, setSaisie] = useState(typeof actuel.siret === "string" ? formaterSiret(actuel.siret) : "");
  const [info, setInfo] = useState<InfosEntreprise | null>(null);
  const [remplacer, setRemplacer] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const champs = info ? comparerFiche(actuel, info) : [];
  const aRemplir = champs.filter((c) => c.etat === "vide");
  const differents = champs.filter((c) => c.etat === "different");

  function basculer(cle: string, coche: boolean) {
    setRemplacer((prev) => {
      const next = new Set(prev);
      if (coche) next.add(cle);
      else next.delete(cle);
      return next;
    });
  }

  async function appliquer() {
    if (!info) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/organization/siret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entreprise: info, remplacer: Array.from(remplacer) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      const { ecrits, conserves, paie } = json.bilan as { ecrits: CleFiche[]; conserves: CleFiche[]; paie: string[] };
      setMessage(
        [
          ecrits.length > 0 ? `Mis à jour : ${ecrits.map((c) => LIBELLES_FICHE[c]).join(", ")}.` : "Fiche déjà à jour.",
          conserves.length > 0 ? `Conservés tels quels : ${conserves.map((c) => LIBELLES_FICHE[c]).join(", ")}.` : null,
          paie.length > 0 ? `Paie : ${paie.join(", ")}.` : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setInfo(null);
      setRemplacer(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-lg flex-col gap-4">
      <div>
        <h3 className="text-lg">Identité de l&apos;entreprise</h3>
        <p className="text-sm text-navy/65">
          Saisissez le SIRET : GODAC lit la fiche publique de l&apos;entreprise et met en place la convention collective, les
          règles de paie et l&apos;identité légale.
          {verifieLe && <> Dernière lecture : {new Date(verifieLe).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.</>}
        </p>
      </div>
      {message && <p role="status" className="text-sm text-teal-ink">{message}</p>}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      <SiretLookup
        value={saisie}
        onChange={setSaisie}
        onFound={(found) => {
          setInfo(found);
          setRemplacer(new Set());
          setMessage(null);
        }}
      />

      {info && (
        <div className="flex flex-col gap-3">
          <ApercuEntreprise info={info} />
          {aRemplir.length > 0 && (
            <div className="text-sm">
              <p className="font-medium">Sera rempli</p>
              <ul className="mt-1 list-disc pl-5 text-navy/75">
                {aRemplir.map((c) => (
                  <li key={c.cle}>
                    {c.libelle} : {c.propose}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {differents.length > 0 && (
            <fieldset className="text-sm">
              <legend className="font-medium">Déjà renseigné autrement — cochez pour remplacer</legend>
              <div className="mt-1 flex flex-col gap-2">
                {differents.map((c) => (
                  <label key={c.cle} className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={remplacer.has(c.cle)} onChange={(e) => basculer(c.cle, e.target.checked)} />
                    <span>
                      <span className="font-medium">{c.libelle}</span>
                      <span className="block text-navy/60">Actuel : {c.actuel}</span>
                      <span className="block text-navy/85">Répertoire : {c.propose}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {aRemplir.length === 0 && differents.length === 0 && <p className="text-sm text-navy/65">Tout est déjà à jour.</p>}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={appliquer}>
              {busy ? "Enregistrement…" : "Appliquer à l'organisation"}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => setInfo(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
