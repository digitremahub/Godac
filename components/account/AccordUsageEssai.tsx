"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { ACCORD_USAGE_TEXTE } from "@/lib/go-navigation/offre";

/**
 * Comptes d'essai GO Navigation : donner ou retirer à tout moment l'accord
 * facultatif de partage du détail d'usage. Sans accord, GODAC ne voit que
 * des statistiques agrégées (nombre de tournées, fonctions utilisées).
 */
export function AccordUsageEssai({ accepteInitial, le }: { accepteInitial: boolean; le: string | null }) {
  const [accepte, setAccepte] = useState(accepteInitial);
  const [date, setDate] = useState(le);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function changer() {
    setBusy(true);
    setErreur(null);
    const r = await fetchGodac<{ accepte: boolean }>("/api/go-navigation/accord-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepte: !accepte }),
    });
    setBusy(false);
    if (!r.ok) {
      setErreur(r.refus.message);
      return;
    }
    setAccepte(r.data.accepte);
    setDate(new Date().toISOString());
  }

  return (
    <Card className="flex max-w-md flex-col gap-2">
      <p className="label">Partage du détail d&apos;usage (essai GO)</p>
      <p className="text-sm text-navy/70">
        Par défaut, GODAC ne mesure que des statistiques agrégées de l&apos;essai (nombre de tournées, fonctions utilisées). Le détail n&apos;est consulté qu&apos;avec votre accord, facultatif.
      </p>
      <p className="text-sm text-navy/70">{ACCORD_USAGE_TEXTE}</p>
      <p className="text-sm font-medium" role="status">
        {accepte ? "Accord donné" : "Pas d'accord donné"}
        {date && <span className="font-normal text-navy/60"> — modifié le {new Date(date).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}</span>}
      </p>
      {erreur && (
        <p role="alert" className="text-sm text-orange-ink">
          {erreur}
        </p>
      )}
      <button type="button" className={accepte ? "btn-secondary" : "btn-primary"} onClick={changer} disabled={busy}>
        {busy ? "Enregistrement…" : accepte ? "Retirer mon accord" : "Donner mon accord"}
      </button>
    </Card>
  );
}
