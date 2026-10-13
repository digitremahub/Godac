"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { IconCopy, IconDownload, IconExternal } from "@/components/layout/icons";
import { liensGoogleMaps, versCsv, versGpx, type ArretExport } from "@/lib/colis/export";
import type { Liste, Run, Stop } from "@/components/colis/commun";
import { LISTE_PRINCIPALE } from "@/lib/colis/listes";

function telecharger(nom: string, contenu: string, type: string) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Sortie de la tournée (dans l'ordre optimisé, arrêts restants) vers une
 * autre application : Google Maps (navigation multi-arrêts), Circuit /
 * Excel (CSV), GPS (GPX), ou simple liste copiée.
 */
export function ExportTournee({ run, stops, listes = [] }: { run: Run; stops: Stop[]; listes?: Liste[] }) {
  const nomListe = new Map(listes.map((l) => [l.id, l.name]));
  const [ouvert, setOuvert] = useState(false);
  const [copie, setCopie] = useState(false);
  const arrets: ArretExport[] = stops.map((s) => ({
    adresse: s.address,
    lat: s.lat,
    lng: s.lng,
    destinataire: s.recipient,
    telephone: s.phone,
    colis: s.parcel_count,
    notes: s.notes,
    liste: (s.list_id && nomListe.get(s.list_id)) || LISTE_PRINCIPALE,
  }));
  const depot = run.start_lat !== null && run.start_lng !== null ? { adresse: run.start_label ?? "Dépôt", lat: run.start_lat, lng: run.start_lng } : null;
  const fichier = (run.name ?? "tournee").normalize("NFD").replace(/[^\w-]+/g, "-").toLowerCase() + `-${run.run_date}`;

  if (!ouvert) {
    return (
      <button type="button" className="btn-secondary w-fit !py-2 text-sm" onClick={() => setOuvert(true)}>
        <IconExternal className="h-4 w-4" /> Ouvrir dans une autre application
      </button>
    );
  }

  // Une tournée déjà commencée repart de la position du téléphone, pas du dépôt.
  const liens = liensGoogleMaps(run.status === "in_progress" ? null : depot, arrets, run.return_to_start ? depot : null);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg">Ouvrir dans une autre application</h2>
        <button type="button" className="btn-ghost !px-2 !py-1 text-sm" onClick={() => setOuvert(false)}>
          Fermer
        </button>
      </div>
      <p className="text-sm text-navy/65">{arrets.length} arrêt(s) restant(s), dans l&apos;ordre optimisé par GODAC.</p>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Google Maps</p>
        {liens.length > 1 && <p className="text-xs text-navy/60">Google Maps limite chaque itinéraire à 10 arrêts : ouvrez les parties l&apos;une après l&apos;autre.</p>}
        <div className="flex flex-wrap gap-2">
          {liens.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="btn-secondary !py-2 text-sm">
              <IconExternal className="h-4 w-4" /> {l.label}
            </a>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Fichiers</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => telecharger(`${fichier}.csv`, versCsv(arrets), "text/csv;charset=utf-8")}>
            <IconDownload className="h-4 w-4" /> CSV (Circuit, Excel, My Maps)
          </button>
          <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => telecharger(`${fichier}.gpx`, versGpx(run.name ?? "Tournée", arrets), "application/gpx+xml")}>
            <IconDownload className="h-4 w-4" /> GPX (GPS)
          </button>
          <button
            type="button"
            className="btn-secondary !py-2 text-sm"
            onClick={async () => {
              const liste = arrets.map((a, i) => `${i + 1}. ${a.adresse}${a.destinataire ? ` (${a.destinataire})` : ""}${a.telephone ? ` · ${a.telephone}` : ""}`).join("\n");
              try {
                await navigator.clipboard.writeText(liste);
                setCopie(true);
                setTimeout(() => setCopie(false), 2000);
              } catch {
                /* presse-papiers indisponible */
              }
            }}
          >
            <IconCopy className="h-4 w-4" /> {copie ? "Copiée !" : "Copier la liste"}
          </button>
        </div>
      </div>
      <p className="text-xs text-navy/55">Waze ne gère qu&apos;une destination à la fois : utilisez le bouton Waze arrêt par arrêt dans GODAC.</p>
    </Card>
  );
}
