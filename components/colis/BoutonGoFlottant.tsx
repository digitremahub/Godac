"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconNavigation } from "@/components/layout/icons";

const CLE = "godac.go.flottant";
const MARGE = 8;
const SEUIL_DEPLACEMENT = 6;

interface Position {
  left: number;
  top: number;
}

function lire(): Position | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLE) ?? "null") as Position | null;
    return v && Number.isFinite(v.left) && Number.isFinite(v.top) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Bouton « GO » flottant que le chauffeur peut DÉPLACER (glisser le doigt) pour
 * qu'il ne gêne plus la liste ou la carte ; il se range contre le bord gauche
 * ou droit le plus proche et sa place est mémorisée sur l'appareil. Un simple
 * appui rouvre GO Navigation.
 */
export function BoutonGoFlottant({ onOuvrir }: { onOuvrir: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [deplace, setDeplace] = useState(false);
  const geste = useRef<{ x: number; y: number; left: number; top: number; actif: boolean } | null>(null);

  const borner = useCallback((p: Position): Position => {
    const el = ref.current;
    const l = el?.offsetWidth ?? 80;
    const h = el?.offsetHeight ?? 56;
    return {
      left: Math.min(Math.max(MARGE, p.left), Math.max(MARGE, window.innerWidth - l - MARGE)),
      top: Math.min(Math.max(MARGE, p.top), Math.max(MARGE, window.innerHeight - h - MARGE)),
    };
  }, []);

  useEffect(() => {
    const m = lire();
    if (m) setPos(borner(m));
    const recadrer = () => setPos((p) => (p ? borner(p) : p));
    window.addEventListener("resize", recadrer);
    return () => window.removeEventListener("resize", recadrer);
  }, [borner]);

  function debut(e: React.PointerEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    geste.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, actif: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function bouge(e: React.PointerEvent<HTMLButtonElement>) {
    const g = geste.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.actif && Math.hypot(dx, dy) < SEUIL_DEPLACEMENT) return;
    g.actif = true;
    setDeplace(true);
    setPos(borner({ left: g.left + dx, top: g.top + dy }));
  }

  function fin(e: React.PointerEvent<HTMLButtonElement>) {
    const g = geste.current;
    geste.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* déjà relâché */
    }
    if (!g?.actif) return onOuvrir();
    setDeplace(false);
    // Rangé contre le bord le plus proche, à la hauteur choisie.
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const aGauche = r.left + r.width / 2 < window.innerWidth / 2;
    const rangee = borner({ left: aGauche ? MARGE : window.innerWidth - r.width - MARGE, top: r.top });
    setPos(rangee);
    try {
      localStorage.setItem(CLE, JSON.stringify(rangee));
    } catch {
      /* stockage indisponible */
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      onPointerDown={debut}
      onPointerMove={bouge}
      onPointerUp={fin}
      onPointerCancel={() => {
        geste.current = null;
        setDeplace(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOuvrir();
        }
      }}
      style={pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto", touchAction: "none" } : { touchAction: "none" }}
      className={`fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-[60] flex min-h-[56px] cursor-grab select-none items-center gap-2 rounded-full bg-teal px-5 text-base font-bold text-on-teal shadow-pop ${deplace ? "scale-105 opacity-90" : ""}`}
      aria-label="Retourner dans GO Navigation (glisser pour déplacer le bouton)"
      title="Glissez pour déplacer"
    >
      <IconNavigation className="h-5 w-5" /> GO
    </button>
  );
}
