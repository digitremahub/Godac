"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { IconRefresh } from "@/components/layout/icons";
import { useScene3D } from "@/components/marketing/useScene3D";
import { ACRONYME, phraseAcronyme } from "@/lib/vitrine/acronyme";
import { etatGodac, peutRejouer, sequenceGodac, type EtatGodac } from "@/lib/vitrine/sequence-godac";

const LETTRES = ACRONYME.lettres;
const SEQUENCE = sequenceGodac(LETTRES.length);
/** « GO » en teal, « DAC » en orange : les deux couleurs du logo. */
const NB_LETTRES_TEAL = 2;

/**
 * État commun aux deux variantes : repli statique, attente de l'entrée à
 * l'écran, lecture une fois, relance au survol (souris) ou au toucher.
 */
function useSequenceGodac(ref: RefObject<Element>) {
  const { autorise, anime } = useScene3D(ref);
  const [dejaVisible, setDejaVisible] = useState(false);
  const [rejeu, setRejeu] = useState(0);
  const debut = useRef<number | null>(null);

  useEffect(() => {
    if (anime && !dejaVisible) {
      debut.current = performance.now();
      setDejaVisible(true);
    }
  }, [anime, dejaVisible]);

  const relancer = useCallback(() => {
    debut.current = performance.now();
    setRejeu((n) => n + 1);
  }, []);

  /** Survol ou toucher : seulement si la séquence est terminée. */
  const relancerSiTerminee = useCallback(() => {
    const ecoule = debut.current === null ? null : performance.now() - debut.current;
    if (peutRejouer(autorise, ecoule, SEQUENCE.dureeTotaleMs)) relancer();
  }, [autorise, relancer]);

  const etat: EtatGodac = etatGodac(autorise, dejaVisible);
  return { autorise, anime, etat, rejeu, relancer, relancerSiTerminee };
}

/**
 * Les cinq lettres s'assemblent en profondeur, puis se déploient une à une
 * en « Gestion · Optimisation · Des · Actifs · Charges », reliées par le trait
 * lumineux d'une tournée. Les mots sont du vrai texte (liste ordonnée) ; les
 * lettres et le tracé sont décoratifs. Sans animation (mouvement réduit,
 * appareil modeste, JS absent), la phrase s'affiche complète et immobile.
 */
export function AnimationGodac() {
  const ref = useRef<HTMLDivElement>(null);
  const { autorise, anime, etat, rejeu, relancer, relancerSiTerminee } = useSequenceGodac(ref);

  return (
    <div
      ref={ref}
      className="godac-scene"
      data-etat={etat}
      data-anime={anime ? "oui" : "non"}
      onPointerEnter={(e) => e.pointerType === "mouse" && relancerSiTerminee()}
      onPointerDown={(e) => e.pointerType !== "mouse" && relancerSiTerminee()}
    >
      <ol key={rejeu} className="godac-liste" aria-label={phraseAcronyme()}>
        {LETTRES.map((l, i) => {
          const e = SEQUENCE.etapes[i]!;
          const style = { "--dl": `${e.delaiLettreMs}ms`, "--dm": `${e.delaiMotMs}ms`, "--dt": `${e.delaiTraitMs ?? 0}ms` } as CSSProperties;
          return (
            <li key={l.lettre + i} className="godac-etape" style={style}>
              <span aria-hidden="true" className={i < NB_LETTRES_TEAL ? "godac-lettre godac-lettre--teal" : "godac-lettre godac-lettre--orange"}>
                {l.lettre}
              </span>
              <span aria-hidden="true" className="godac-voie">
                {e.delaiTraitMs !== null && <span className="godac-trait" />}
                <span className={i === LETTRES.length - 1 ? "godac-noeud godac-noeud--arrivee" : "godac-noeud"} />
              </span>
              <span className="godac-mot">
                {l.liaison && <span className="godac-et">{l.liaison} </span>}
                {l.mot}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-8 flex min-h-11 justify-center">
        <button
          type="button"
          onClick={relancer}
          tabIndex={autorise ? 0 : -1}
          aria-hidden={autorise ? undefined : true}
          className={`godac-rejouer ${autorise ? "" : "invisible"}`}
        >
          <IconRefresh className="h-4 w-4" />
          Rejouer l&apos;animation
        </button>
      </div>
    </div>
  );
}

/**
 * Logo animé compact (pied de page) : les cinq lettres s'assemblent, le trait
 * se dessine dessous, la phrase complète reste affichée en texte.
 */
export function LogoGodacAnime() {
  const ref = useRef<HTMLDivElement>(null);
  const { anime, etat, rejeu, relancerSiTerminee } = useSequenceGodac(ref);

  return (
    <div
      ref={ref}
      className="godac-compact"
      data-etat={etat}
      data-anime={anime ? "oui" : "non"}
      onPointerEnter={(e) => e.pointerType === "mouse" && relancerSiTerminee()}
      onPointerDown={(e) => e.pointerType !== "mouse" && relancerSiTerminee()}
    >
      <div key={rejeu} aria-hidden="true" className="godac-compact-lettres">
        {LETTRES.map((l, i) => (
          <span
            key={l.lettre + i}
            className={i < NB_LETTRES_TEAL ? "godac-lettre godac-lettre--teal" : "godac-lettre godac-lettre--orange"}
            style={{ "--dl": `${SEQUENCE.etapes[i]!.delaiLettreMs}ms` } as CSSProperties}
          >
            {l.lettre}
          </span>
        ))}
        <span className="godac-compact-trait" />
      </div>
      <p className="godac-compact-phrase">{phraseAcronyme()}</p>
    </div>
  );
}
