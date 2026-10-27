"use client";

import { useEffect, useState } from "react";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { addDays } from "@/lib/planning/dates";
import { libelleJour, texteApercu, texteResultat } from "@/lib/planning/semaine";
import { Fenetre } from "@/components/planning/Fenetre";
import type { OnResultat } from "@/components/planning/FenetresPlanning";

type Reponse = { created: number; skipped: number; conflicts: number; a_remplacer?: number; fusionnees?: number; source_count: number; warning?: string | null };

const json = (corps: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });

/**
 * Recopier des semaines (POST /api/planning/duplicate-week), avec aperçu
 * (dry_run) avant de valider. Deux usages :
 * - « Copier depuis la semaine précédente » : semaine N-1 → semaine affichée ;
 * - « Copier une semaine type sur le mois » : une semaine du mois choisie →
 *   les semaines suivantes du mois.
 * Rien n'est écrasé (créneaux déjà pris ignorés) ; un chauffeur en congé ou
 * en arrêt le jour recopié n'est pas placé : la case reste « à remplacer ».
 */
export function RecopieSemaines({
  mode,
  lundi,
  lundisDuMois = [],
  serviceId,
  nomService,
  onFermer,
  onResultat,
}: {
  mode: "precedente" | "mois";
  /** Semaine affichée (précédente) ; ignoré pour le mois. */
  lundi: string;
  /** Lundis des semaines du mois (mode « mois »). */
  lundisDuMois?: string[];
  serviceId: string;
  nomService: string | null;
  onFermer: () => void;
  onResultat: OnResultat;
}) {
  const [source, setSource] = useState(mode === "mois" ? (lundisDuMois[0] ?? lundi) : addDays(lundi, -7));
  const suivantes = lundisDuMois.filter((l) => l > source).length;
  const corps =
    mode === "precedente"
      ? { source_week_start: addDays(lundi, -7), target_week_start: lundi, service_id: serviceId || undefined }
      : { source_week_start: source, weeks: Math.max(1, suivantes), service_id: serviceId || undefined };
  const [apercu, setApercu] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const impossible = mode === "mois" && suivantes === 0;

  useEffect(() => {
    if (impossible) {
      setChargement(false);
      setApercu(null);
      return;
    }
    let annule = false;
    setChargement(true);
    setErreur(null);
    void fetchGodac<Reponse>("/api/planning/duplicate-week", json({ ...corps, dry_run: true })).then((r) => {
      if (annule) return;
      setChargement(false);
      if (r.ok) setApercu(r.data);
      else setErreur(r.refus.message);
    });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, lundi, serviceId]);

  async function valider() {
    setBusy(true);
    setErreur(null);
    const r = await fetchGodac<Reponse>("/api/planning/duplicate-week", json(corps));
    setBusy(false);
    if (!r.ok) return setErreur(r.refus.message);
    const texte = texteResultat({ creees: r.data.created, ignorees: r.data.skipped, conflits: r.data.conflicts, aRemplacer: r.data.a_remplacer, fusionnees: r.data.fusionnees });
    onResultat(`Recopie faite : ${texte}.${r.data.warning ? ` ${r.data.warning}` : ""}`, r.data.conflicts || r.data.a_remplacer ? "attention" : "ok");
    onFermer();
  }

  const titre = mode === "precedente" ? "Copier depuis la semaine précédente" : "Copier une semaine type sur le mois";
  const portee = nomService ? ` · ${nomService}` : " · tous vos services";
  return (
    <Fenetre
      titre={titre}
      sousTitre={
        mode === "precedente"
          ? `Semaine du ${libelleJour(addDays(lundi, -7))} → semaine du ${libelleJour(lundi)}${portee}`
          : `Mêmes jours, heures, chauffeurs et véhicules sur les semaines suivantes du mois${portee}`
      }
      onFermer={onFermer}
    >
      {mode === "mois" && (
        <fieldset className="mb-3">
          <legend className="label">Semaine type</legend>
          <div className="flex flex-wrap gap-1.5">
            {lundisDuMois.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={source === l}
                onClick={() => setSource(l)}
                className={`min-h-[44px] rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${source === l ? "border-teal bg-teal/20 font-semibold text-teal-ink" : "border-navy/15 hover:border-teal/50"}`}
              >
                Sem. du {libelleJour(l)}
              </button>
            ))}
          </div>
          {!impossible && (
            <p className="mt-2 text-xs text-navy/60">
              Recopiée sur {suivantes} semaine{suivantes > 1 ? "s" : ""} : jusqu&apos;à la semaine du {libelleJour(lundisDuMois.at(-1)!)}.
            </p>
          )}
        </fieldset>
      )}

      <div className="rounded-lg bg-navy/[0.04] p-3 text-sm" aria-live="polite">
        {impossible
          ? "C'est la dernière semaine du mois : choisissez une semaine plus tôt."
          : chargement
            ? "Calcul de l'aperçu…"
            : apercu
              ? apercu.source_count === 0
                ? "La semaine source est vide : rien à recopier."
                : `${texteApercu({ creees: apercu.created, ignorees: apercu.skipped, conflits: apercu.conflicts, aRemplacer: apercu.a_remplacer, fusionnees: apercu.fusionnees })}.`
              : null}
      </div>
      <p className="mt-2 text-xs text-navy/55">Rien n&apos;est écrasé : les cases déjà remplies gardent leur chauffeur.</p>
      {erreur && (
        <p role="alert" className="mt-2 text-sm text-orange-ink">
          {erreur}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary min-h-[44px] flex-1" disabled={busy || chargement || impossible || !apercu?.created} onClick={valider}>
          {busy ? "Recopie…" : apercu?.created ? `Créer ${apercu.created} affectation${apercu.created > 1 ? "s" : ""}` : "Recopier"}
        </button>
        <button type="button" className="btn-secondary min-h-[44px]" onClick={onFermer}>
          Annuler
        </button>
      </div>
    </Fenetre>
  );
}
