"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { IconRefresh } from "@/components/layout/icons";
import { useScene3D } from "@/components/marketing/useScene3D";
import { ACRONYME, phraseAcronyme } from "@/lib/vitrine/acronyme";
import { GLYPHES_GODAC, HAUTEUR_GLYPHE, ORIGINE_Y_GLYPHE, type GlypheGodac } from "@/lib/vitrine/glyphes-godac";
import { etatGodac, peutRejouer, sequenceGodac, type EtatGodac } from "@/lib/vitrine/sequence-godac";

const LETTRES = ACRONYME.lettres;
const SEQUENCE = sequenceGodac(GLYPHES_GODAC.length);
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

/** Une lettre du logo, en vectoriel (couleur = `currentColor`, posée par la classe). */
function Glyphe({ g, className, style }: { g: GlypheGodac; className: string; style?: CSSProperties }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`${g.x} ${ORIGINE_Y_GLYPHE} ${g.largeur} ${HAUTEUR_GLYPHE}`}
      className={className}
      style={{ ...style, "--w": g.largeur } as CSSProperties}
    >
      <path d={g.d} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

const classeLettre = (i: number) => (i < NB_LETTRES_TEAL ? "godac-lettre godac-lettre--teal" : "godac-lettre godac-lettre--orange");
/** Écart entre les centres de deux lettres voisines (repère du logo). */
const suite = (i: number) => {
  const g = GLYPHES_GODAC[i]!;
  const n = GLYPHES_GODAC[i + 1];
  return n ? g.largeur / 2 + n.ecart + n.largeur / 2 : 0;
};

/**
 * Les cinq lettres du logo (tracés vectoriels du wordmark) s'assemblent en
 * profondeur, puis le trait lumineux d'une tournée les relie par des points.
 * Aucun mot affiché : la phrase officielle reste en texte masqué visuellement.
 * Sans animation (mouvement réduit, appareil modeste, JS absent), les lettres
 * et le tracé s'affichent complets et immobiles.
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
      <p className="sr-only">{phraseAcronyme()}</p>
      <div key={rejeu} aria-hidden="true" className="godac-rangee">
        {GLYPHES_GODAC.map((g, i) => {
          const e = SEQUENCE.etapes[i]!;
          const style = {
            "--dl": `${e.delaiLettreMs}ms`,
            "--dn": `${e.delaiNoeudMs}ms`,
            "--dt": `${e.delaiTraitMs ?? 0}ms`,
            "--ecart": g.ecart,
            "--w": g.largeur,
            "--suite": suite(i),
          } as CSSProperties;
          return (
            <div key={g.lettre + i} className="godac-etape" style={style}>
              <Glyphe g={g} className={classeLettre(i)} />
              <span className="godac-voie">
                {e.delaiTraitMs !== null && <span className="godac-trait" />}
                <span className={i === GLYPHES_GODAC.length - 1 ? "godac-noeud godac-noeud--arrivee" : "godac-noeud"} />
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-10 flex min-h-11 justify-center">
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
 * Logo animé compact (pied de page) : les cinq lettres du logo s'assemblent,
 * le trait se dessine dessous. Aucun texte visible ; la phrase officielle est
 * portée par l'étiquette d'accessibilité.
 */
export function LogoGodacAnime() {
  const ref = useRef<HTMLDivElement>(null);
  const { anime, etat, rejeu, relancerSiTerminee } = useSequenceGodac(ref);

  return (
    <div
      ref={ref}
      className="godac-compact"
      role="img"
      aria-label={`GODAC : ${phraseAcronyme()}`}
      data-etat={etat}
      data-anime={anime ? "oui" : "non"}
      onPointerEnter={(e) => e.pointerType === "mouse" && relancerSiTerminee()}
      onPointerDown={(e) => e.pointerType !== "mouse" && relancerSiTerminee()}
    >
      <div key={rejeu} aria-hidden="true" className="godac-compact-lettres">
        {GLYPHES_GODAC.map((g, i) => (
          <Glyphe
            key={g.lettre + i}
            g={g}
            className={classeLettre(i)}
            style={{ "--dl": `${SEQUENCE.etapes[i]!.delaiLettreMs}ms`, "--ecart": g.ecart } as CSSProperties}
          />
        ))}
        <span className="godac-compact-trait" />
      </div>
    </div>
  );
}
