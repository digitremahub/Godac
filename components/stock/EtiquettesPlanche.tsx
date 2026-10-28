"use client";

import { useRef, useState } from "react";
import { EtiquetteApercu } from "@/components/stock/EtiquetteApercu";
import { Champ, Message } from "@/components/stock/commun";
import { etiquetteVierge } from "@/lib/stock/etiquettes";
import { DEFINITION_FORMATS, ETIQUETTES_MAX, FORMATS_ETIQUETTE, nombrePages, parPage, type CleFormatEtiquette } from "@/lib/stock/formats-etiquette";
import { nouvelleCle } from "@/lib/stock/mouvements";
import type { ChampEtiquette } from "@/lib/stock/profils";

const PRESETS = [24, 50, 100] as const;

/**
 * Planche d'étiquettes vierges numérotées : on génère N codes d'avance (compteur atomique côté base),
 * on imprime la planche, puis on colle les étiquettes sur les colis ou palettes. Le premier scan d'un code
 * pré-imprimé inconnu crée l'unité avec ce code (Entrée › scanner).
 */
export function EtiquettesPlanche({
  formatInitial,
  prefixeExemple,
  annee,
  entreprise,
  champs,
  codesInstalles,
}: {
  formatInitial: CleFormatEtiquette;
  prefixeExemple: string;
  annee: number;
  entreprise: string;
  champs: readonly ChampEtiquette[];
  codesInstalles: boolean;
}) {
  const [nombre, setNombre] = useState<number>(24);
  const [format, setFormat] = useState<CleFormatEtiquette>(formatInitial);
  const [debut, setDebut] = useState(0);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [resultat, setResultat] = useState<{ url: string; nombre: number; premier: string; dernier: string } | null>(null);
  // Une clé par demande tant qu'elle n'a pas abouti : un nouvel essai après coupure ne consomme pas d'autres codes.
  const cle = useRef<string | null>(null);
  const f = DEFINITION_FORMATS[format];

  async function generer(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isInteger(nombre) || nombre < 1 || nombre > ETIQUETTES_MAX) {
      setMessage({ texte: `Indiquez un nombre d'étiquettes entre 1 et ${ETIQUETTES_MAX}.`, erreur: true });
      return;
    }
    setEnCours(true);
    setMessage(null);
    cle.current ??= nouvelleCle("planche");
    try {
      const r = await fetch("/api/stock/etiquettes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "vierges", nombre, cle: cle.current, format, debut: f.planche ? debut : 0 }),
      });
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as { error?: string };
        cle.current = null;
        setMessage({ texte: json.error ?? "Impression impossible, réessayez.", erreur: true });
        return;
      }
      const blob = await r.blob();
      if (resultat) URL.revokeObjectURL(resultat.url);
      const url = URL.createObjectURL(blob);
      cle.current = null;
      setResultat({ url, nombre: Number(r.headers.get("X-Etiquettes") ?? nombre), premier: decodeURIComponent(r.headers.get("X-Code-Premier") ?? ""), dernier: decodeURIComponent(r.headers.get("X-Code-Dernier") ?? "") });
      setMessage({ texte: `${nombre} étiquettes générées. Ouvrez le PDF pour l'imprimer.`, erreur: false });
    } catch {
      // Coupure : la clé est conservée, un nouvel essai redonnera les mêmes codes.
      setMessage({ texte: "Pas de connexion : réessayez dans un instant (les codes ne seront pas consommés en double).", erreur: true });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={generer} className="card flex flex-col gap-4 !p-4 sm:!p-5" aria-labelledby="pl-titre">
        <div>
          <h2 id="pl-titre" className="text-lg font-bold">
            Planche d&apos;étiquettes numérotées
          </h2>
          <p className="mt-1 text-sm text-navy/65">Générez des codes d&apos;avance, imprimez-les, collez-les sur vos colis ou palettes. Au premier scan d&apos;un code inconnu, l&apos;unité est créée avec ce code.</p>
        </div>

        <fieldset>
          <legend className="label">Nombre d&apos;étiquettes</legend>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((n) => (
              <button key={n} type="button" aria-pressed={nombre === n} onClick={() => setNombre(n)} className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-semibold ${nombre === n ? "border-teal-ink bg-teal/10" : "border-navy/[0.14] bg-surface"}`}>
                {n}
              </button>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <span>Autre :</span>
              <input className="input !w-24" type="number" min={1} max={ETIQUETTES_MAX} inputMode="numeric" value={nombre} onChange={(e) => setNombre(Math.floor(Number(e.target.value)) || 0)} aria-label="Nombre d'étiquettes" />
            </label>
          </div>
          <p className="mt-1.5 text-xs text-navy/65">
            {ETIQUETTES_MAX} au plus par demande. {nombrePages(nombre, f, f.planche ? debut : 0)} page{nombrePages(nombre, f, f.planche ? debut : 0) > 1 ? "s" : ""} au format choisi ({parPage(f)} étiquette{parPage(f) > 1 ? "s" : ""} par page).
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Champ libelle="Format" aide={f.aide}>
            {(id, aide) => (
              <select id={id} aria-describedby={aide} className="input" value={format} onChange={(e) => setFormat(e.target.value as CleFormatEtiquette)}>
                {FORMATS_ETIQUETTE.map((x) => (
                  <option key={x} value={x}>
                    {DEFINITION_FORMATS[x].libelle}
                  </option>
                ))}
              </select>
            )}
          </Champ>
          {f.planche && (
            <Champ libelle="Étiquettes déjà utilisées sur la première planche" aide="Pour réutiliser une planche entamée : les premiers emplacements restent vides.">
              {(id, aide) => <input id={id} aria-describedby={aide} className="input" type="number" min={0} max={parPage(f) - 1} inputMode="numeric" value={debut} onChange={(e) => setDebut(Math.max(0, Math.min(parPage(f) - 1, Math.floor(Number(e.target.value)) || 0)))} />}
            </Champ>
          )}
        </div>

        <div>
          <span className="label">Aperçu</span>
          <EtiquetteApercu donnees={etiquetteVierge(`${prefixeExemple}-${annee}-000001`, { entreprise, date: "JJ/MM/AAAA" }, champs)} format={format} titre="Aperçu d'une étiquette numérotée" />
        </div>

        <div>
          <button type="submit" className="btn-primary min-h-11 w-full sm:w-auto" disabled={enCours || !codesInstalles}>
            {enCours ? "Génération…" : `Générer ${nombre || ""} codes et le PDF`}
          </button>
          {!codesInstalles && <p className="mt-1.5 text-xs text-orange-ink">Disponible après la mise à jour de la base.</p>}
        </div>
      </form>

      <Message message={message?.texte ?? null} erreur={message?.erreur} />
      <div aria-live="polite" className="sr-only">
        {resultat ? "PDF prêt" : ""}
      </div>
      {resultat && (
        <div className="card flex flex-col gap-2 !p-4">
          <p className="text-sm font-semibold">{resultat.nombre} étiquettes prêtes{resultat.premier ? ` : de ${resultat.premier} à ${resultat.dernier}` : ""}.</p>
          <div className="flex flex-wrap gap-2">
            <a href={resultat.url} target="_blank" rel="noreferrer" className="btn-primary min-h-11">
              Ouvrir le PDF pour imprimer
            </a>
            <a href={resultat.url} download="etiquettes-stock.pdf" className="btn-secondary min-h-11">
              Télécharger
            </a>
          </div>
          <p className="text-xs text-navy/65">Imprimez à l&apos;échelle 100 % (sans « ajuster à la page ») pour que les étiquettes tombent bien sur la planche adhésive.</p>
        </div>
      )}
    </div>
  );
}
