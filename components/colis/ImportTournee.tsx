"use client";

import { useRef, useState } from "react";
import { IconUpload } from "@/components/layout/icons";
import { lireFichier, lireListe, type PointImporte } from "@/lib/colis/import";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { api } from "@/components/colis/commun";

const MAX = 200;

/**
 * Import d'une liste d'adresses dans la tournée : lien Google Maps
 * partagé, fichier (liste Google enregistrée en CSV, Google My Maps en
 * KML, Takeout en GeoJSON, GPX, Circuit / Excel en CSV) ou liste collée.
 */
export function ImportTournee({ runId, onImporte }: { runId: string; onImporte: (message: string, ok: boolean) => Promise<void> | void }) {
  const [ouvert, setOuvert] = useState(false);
  const [lien, setLien] = useState("");
  const [texte, setTexte] = useState("");
  const [apercu, setApercu] = useState<{ source: string; points: PointImporte[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const fichierRef = useRef<HTMLInputElement>(null);

  function proposer(source: string, points: PointImporte[]) {
    setErreur(null);
    if (!points.length) return setErreur("Aucune adresse reconnue.");
    setApercu({ source, points: points.slice(0, MAX) });
  }

  async function depuisLien() {
    setBusy("lien");
    setErreur(null);
    try {
      const { points } = await api<{ points: PointImporte[] }>("/api/colis/import", { method: "POST", body: JSON.stringify({ url: lien.trim() }) });
      proposer("Lien Google Maps", points);
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function depuisFichier(f: File) {
    if (f.size > 3_000_000) return setErreur("Fichier trop lourd (3 Mo au plus).");
    proposer(f.name, lireFichier(f.name, await f.text()));
    if (fichierRef.current) fichierRef.current.value = "";
  }

  async function importer() {
    if (!apercu) return;
    setBusy("import");
    try {
      const r = await api<{ ajoutes: number; regroupes: number; ignores: number; sansGps: number }>("/api/colis/arrets/bulk", {
        method: "POST",
        body: JSON.stringify({ run_id: runId, points: apercu.points.map((p) => ({ ...p, telephone: p.telephone ?? null })) }),
      });
      setApercu(null);
      setLien("");
      setTexte("");
      setOuvert(false);
      await onImporte(
        [
          `${r.ajoutes} arrêt(s) importé(s)`,
          r.regroupes && `${r.regroupes} regroupé(s) avec une même adresse`,
          r.ignores && `${r.ignores} ignoré(s)`,
          r.sansGps && `${r.sansGps} adresse(s) à vérifier`,
        ]
          .filter(Boolean)
          .join(" · ") + ". Lancez « Optimiser l'ordre ».",
        !r.sansGps && !r.ignores,
      );
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!ouvert) {
    return (
      <button type="button" className="btn-ghost w-fit !px-2 !py-1.5 text-sm" onClick={() => setOuvert(true)}>
        <IconUpload className="h-4 w-4" /> Importer une liste (Google Maps, fichier…)
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-navy/10 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Importer une liste d&apos;adresses</h3>
        <button type="button" className="btn-ghost !px-2 !py-1 text-sm" onClick={() => (setOuvert(false), setApercu(null), setErreur(null))}>
          Fermer
        </button>
      </div>

      {apercu ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <strong>{apercu.points.length}</strong> adresse(s) trouvée(s) · {apercu.source}
          </p>
          <ol className="max-h-56 list-decimal overflow-y-auto rounded-lg bg-navy/[0.03] py-2 pl-8 pr-3 text-sm">
            {apercu.points.map((p, i) => (
              <li key={i} className="py-0.5">
                {p.adresse ?? `${p.lat?.toFixed(5)}, ${p.lng?.toFixed(5)}`}
                {(p.nom || p.telephone) && <span className="text-navy/55"> · {[p.nom, p.telephone].filter(Boolean).join(" · ")}</span>}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy !== null} onClick={importer}>
              {busy === "import" ? "Import et géolocalisation…" : `Ajouter ${apercu.points.length} adresse(s) à la tournée`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setApercu(null)}>
              Retour
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Lien Google Maps</span>
            <span className="text-xs text-navy/60">Dans Google Maps : itinéraire avec vos arrêts → Partager → Copier le lien.</span>
            <div className="flex gap-2">
              <input className="input flex-1" value={lien} onChange={(e) => setLien(e.target.value)} placeholder="https://maps.app.goo.gl/…" inputMode="url" />
              <button type="button" className="btn-secondary" disabled={busy !== null || lien.trim().length < 12} onClick={depuisLien}>
                {busy === "lien" ? "Lecture…" : "Lire"}
              </button>
            </div>
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Fichier</span>
            <span className="text-xs text-navy/60">
              Liste Google enregistrée (Google Takeout : CSV ou GeoJSON), Google My Maps (KML), GPX, ou CSV Circuit / Excel avec une colonne adresse (et téléphone).
            </span>
            <input ref={fichierRef} type="file" accept=".csv,.tsv,.kml,.geojson,.json,.gpx,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && depuisFichier(e.target.files[0])} />
            <button type="button" className="btn-secondary w-fit" onClick={() => fichierRef.current?.click()}>
              <IconUpload className="h-4 w-4" /> Choisir un fichier
            </button>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Liste collée</span>
            <span className="text-xs text-navy/60">Une adresse par ligne, éventuellement suivie du téléphone du client.</span>
            <textarea className="input min-h-24" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={"12 rue des Lilas, 69230 Saint-Genis-Laval - 06 12 34 56 78\n3 avenue Foch, 69006 Lyon"} />
            <button type="button" className="btn-secondary w-fit" disabled={texte.trim().length < 5} onClick={() => proposer("Liste collée", lireListe(texte))}>
              Lire la liste
            </button>
          </label>
        </>
      )}
      {erreur && <p className="rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">{erreur}</p>}
    </div>
  );
}
