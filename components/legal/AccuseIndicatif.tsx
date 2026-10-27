"use client";

import { useId, useState } from "react";

interface Accuse {
  le: string;
  par: string;
}

const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

/**
 * Case d'accusé de lecture (une fois par organisation) : cocher enregistre la
 * prise de connaissance, horodatée, au journal d'audit. Proposée à la
 * direction et au comptable seulement ; sans effet bloquant sur les écrans.
 */
export function AccuseIndicatif({ accuseInitial }: { accuseInitial: Accuse | null }) {
  const id = useId();
  const [accuse, setAccuse] = useState<Accuse | null>(accuseInitial);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function valider() {
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await fetch("/api/legal/accuse-indicatif", { method: "POST" });
      const json = (await res.json().catch(() => null)) as (Accuse & { error?: string }) | null;
      if (!res.ok || !json?.le) throw new Error(json?.error ?? "Enregistrement impossible.");
      setAccuse({ le: json.le, par: json.par });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="mt-2 text-xs text-navy/70" aria-live="polite">
      {accuse ? (
        <p>
          Pris en compte le {dateFr(accuse.le)}
          {accuse.par ? ` par ${accuse.par}` : ""}.
        </p>
      ) : (
        <>
          <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
            <input id={id} type="checkbox" checked={false} disabled={envoi} onChange={valider} className="mt-0.5 h-4 w-4 shrink-0 accent-teal" />
            <span>
              J&apos;ai pris connaissance que les paramètres et les résultats (paie, TICPE, carburant) restent à vérifier par mon expert-comptable / responsable paie.
            </span>
          </label>
          {erreur && (
            <p role="alert" className="mt-1 text-orange-ink">
              {erreur}
            </p>
          )}
        </>
      )}
    </div>
  );
}
