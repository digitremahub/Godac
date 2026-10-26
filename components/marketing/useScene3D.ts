"use client";

import { useEffect, useState, type RefObject } from "react";
import { raisonRepli, type EnvironnementScene } from "@/lib/vitrine/scene";

/** Lit les capacités du navigateur utiles à la décision de repli. */
function lireEnvironnement(): EnvironnementScene {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  let css3d = true;
  try {
    css3d = CSS.supports("transform-style", "preserve-3d") && CSS.supports("perspective", "100px");
  } catch {
    // CSS.supports absent : on suppose la 3D disponible.
  }
  return {
    mouvementReduit: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    coeurs: nav.hardwareConcurrency,
    memoireGo: nav.deviceMemory,
    economieDonnees: nav.connection?.saveData === true,
    css3d,
  };
}

/**
 * Pilote une scène 3D décorative. Le rendu serveur est la version statique
 * (tracé complet, aucune animation) ; une fois monté, `autorise` passe à vrai
 * seulement si l'appareil et les préférences le permettent, et `anime` n'est
 * vrai que lorsque la scène est à l'écran et l'onglet visible.
 */
export function useScene3D(ref: RefObject<Element>): { autorise: boolean; anime: boolean } {
  const [autorise, setAutorise] = useState(false);
  const [visible, setVisible] = useState(false);
  const [ongletActif, setOngletActif] = useState(true);

  useEffect(() => {
    const requete = window.matchMedia("(prefers-reduced-motion: reduce)");
    const evaluer = () => setAutorise(raisonRepli(lireEnvironnement()) === null);
    evaluer();
    requete.addEventListener("change", evaluer);
    return () => requete.removeEventListener("change", evaluer);
  }, []);

  useEffect(() => {
    if (!autorise) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(([entree]) => setVisible(entree?.isIntersecting ?? false), { rootMargin: "80px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [autorise, ref]);

  useEffect(() => {
    if (!autorise) return;
    const maj = () => setOngletActif(!document.hidden);
    maj();
    document.addEventListener("visibilitychange", maj);
    return () => document.removeEventListener("visibilitychange", maj);
  }, [autorise]);

  return { autorise, anime: autorise && visible && ongletActif };
}
