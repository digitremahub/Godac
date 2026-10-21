"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LIBELLE_SOURCE } from "@/lib/colis/opening-hours";
import type { Semaine } from "@/lib/colis/horaires";
import { PRESETS_CRENEAU, choisirCreneau, suggestionOuverture, validerChoix, type ChoixCreneau, type CleCreneau } from "@/lib/colis/creneau";

/** Fiche horaires de l'annuaire (saisie, ou trouvée sur internet) pour l'adresse saisie. */
export interface FicheOuverture {
  adresse: string;
  label: string | null;
  semaine: Semaine;
  source: string | null;
}

/**
 * Horaires d'ouverture connus de l'adresse en cours de saisie (annuaire des
 * adresses pro : saisis à la main ou trouvés sur internet), cherchés dès
 * que l'adresse est tapée, avant l'ajout.
 */
export function useHorairesOuverture(adresse: string, actif: boolean): { fiche: FicheOuverture | null; chargement: boolean } {
  const [fiche, setFiche] = useState<FicheOuverture | null>(null);
  const [chargement, setChargement] = useState(false);
  const texte = adresse.trim();
  useEffect(() => {
    if (!actif || texte.length < 5) {
      setFiche(null);
      setChargement(false);
      return;
    }
    let vivant = true;
    const minuterie = setTimeout(async () => {
      setChargement(true);
      try {
        const res = await fetch(`/api/colis/horaires?adresse=${encodeURIComponent(texte)}`);
        const json = (await res.json().catch(() => ({}))) as { fiche?: { label?: string | null; weekly_schedule?: unknown; source?: string | null } | null };
        if (!vivant) return;
        const f = json.fiche;
        setFiche(f?.weekly_schedule && typeof f.weekly_schedule === "object" ? { adresse: texte, label: f.label ?? null, semaine: f.weekly_schedule as Semaine, source: f.source ?? null } : null);
      } catch {
        if (vivant) setFiche(null);
      } finally {
        if (vivant) setChargement(false);
      }
    }, 450);
    return () => {
      vivant = false;
      clearTimeout(minuterie);
    };
  }, [texte, actif]);
  // Fiche d'une adresse précédente (réponse en retard) : ignorée.
  return { fiche: fiche && fiche.adresse === texte ? fiche : null, chargement };
}

/** Puce de choix : 44 px de haut au moins, défilable horizontalement avec les autres. */
function Puce({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={`${actif ? "btn-primary" : "btn-secondary"} !min-h-[44px] shrink-0 snap-start whitespace-nowrap !rounded-full !px-4 !py-2 text-sm`}
    >
      {children}
    </button>
  );
}

/**
 * Étape « Créneau » du formulaire d'ajout, juste avant le bouton d'ajout :
 * boutons rapides (Aucun, Avant 10 h, créneaux Predict DPD…), créneau
 * personnalisé (début facultatif, fin), et horaires d'ouverture connus de
 * l'adresse avec « Utiliser les horaires d'ouverture ».
 */
export function EtapeCreneau({
  value,
  onChange,
  fiche,
  chargement = false,
  ymd,
  quand = "aujourd'hui",
  indication,
  titre = "Créneau",
  idBase,
}: {
  value: ChoixCreneau;
  onChange: (c: ChoixCreneau) => void;
  /** Horaires d'ouverture connus de l'adresse (useHorairesOuverture). */
  fiche?: FicheOuverture | null;
  chargement?: boolean;
  /** Jour de la tournée (AAAA-MM-JJ). */
  ymd: string;
  /** « aujourd'hui », ou « le 24/10 » pour une tournée d'un autre jour. */
  quand?: string;
  /** Origine du créneau pré-sélectionné (« Lu sur l'étiquette »). */
  indication?: string | null;
  titre?: string | null;
  /** Préfixe des identifiants des champs (plusieurs sélecteurs sur un écran). */
  idBase: string;
}) {
  const ouverture = fiche ? suggestionOuverture(fiche.semaine, ymd, quand) : null;
  const resultat = validerChoix(value);
  const choisir = (cle: CleCreneau) => onChange(choisirCreneau(cle, value));
  const source = fiche?.source ? (LIBELLE_SOURCE[fiche.source] ?? fiche.source) : null;

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={`${idBase}-aide`}>
      {titre && <legend className="mb-1 text-sm font-semibold">{titre}</legend>}
      {chargement && <p className="text-xs text-navy/55">Recherche des horaires d&apos;ouverture…</p>}
      {ouverture && (
        <div className={`rounded-lg px-3 py-2 text-sm ${ouverture.ferme ? "bg-orange/10 text-orange-ink" : "bg-teal/10 text-teal-ink"}`}>
          <p className="font-semibold">{ouverture.libelle}</p>
          {(fiche?.label || source) && <p className="text-xs opacity-80">{[fiche?.label, source && `source : ${source}`].filter(Boolean).join(" · ")}</p>}
        </div>
      )}
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Choix du créneau">
        <Puce actif={value.cle === "aucun"} onClick={() => choisir("aucun")}>
          Aucun
        </Puce>
        {ouverture && !ouverture.ferme && (
          <Puce actif={value.cle === "ouverture"} onClick={() => choisir("ouverture")}>
            Utiliser les horaires d&apos;ouverture
          </Puce>
        )}
        {PRESETS_CRENEAU.map((p) => (
          <Puce key={p.cle} actif={value.cle === p.cle} onClick={() => choisir(p.cle)}>
            {p.libelle}
          </Puce>
        ))}
        <Puce actif={value.cle === "perso"} onClick={() => choisir("perso")}>
          Personnalisé
        </Puce>
      </div>
      {value.cle === "perso" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5" htmlFor={`${idBase}-debut`}>
            De
            <input
              id={`${idBase}-debut`}
              type="time"
              className="input !min-h-[44px] !w-auto"
              value={value.debut}
              onChange={(e) => onChange({ ...value, debut: e.target.value })}
              aria-label="Début du créneau (facultatif)"
            />
          </label>
          <label className="flex items-center gap-1.5" htmlFor={`${idBase}-fin`}>
            à
            <input
              id={`${idBase}-fin`}
              type="time"
              className="input !min-h-[44px] !w-auto"
              value={value.fin}
              onChange={(e) => onChange({ ...value, fin: e.target.value })}
              aria-label="Fin du créneau"
              required
            />
          </label>
          <span className="text-xs text-navy/55">Début facultatif : sans début, « avant » l&apos;heure de fin.</span>
        </div>
      )}
      {!resultat.ok && (
        <p role="alert" className="text-xs font-semibold text-orange-ink">
          {resultat.erreur}
        </p>
      )}
      <p id={`${idBase}-aide`} className="text-xs text-navy/55">
        {indication && value.cle !== "aucun" ? `${indication} · ` : ""}
        {value.cle === "ouverture"
          ? "L'optimisation suivra ces horaires d'ouverture."
          : value.cle === "aucun"
            ? ouverture && !ouverture.ferme
              ? "Sans créneau du jour : l'optimisation suit les horaires d'ouverture."
              : "Aucune contrainte horaire pour cet arrêt."
            : "Créneau du jour, prioritaire sur les horaires d'ouverture."}
      </p>
    </fieldset>
  );
}
