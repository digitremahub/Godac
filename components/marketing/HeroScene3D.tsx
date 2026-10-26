"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { IconCoins } from "@/components/layout/icons";
import { Pave3D } from "@/components/marketing/Pave3D";
import { useScene3D } from "@/components/marketing/useScene3D";
import { inclinaison, progressionArrets, tracerTournee, type Point } from "@/lib/vitrine/scene";

/** Arrêts de la tournée, dans le repère 400 × 300 du plan. */
const ARRETS: Point[] = [
  { x: 48, y: 236 },
  { x: 118, y: 168 },
  { x: 176, y: 214 },
  { x: 244, y: 128 },
  { x: 304, y: 160 },
  { x: 350, y: 66 },
];
const TRACE = tracerTournee(ARRETS);
const PROGRESSION = progressionArrets(ARRETS);
const INCLINAISON_MAX = 5;

/**
 * Scène d'accueil : une tournée qui se dessine sur une carte en perspective,
 * un camion et des colis en volumes simples, l'écran carburant en
 * profondeur. Purement décorative (aria-hidden) ; le titre et les appels à
 * l'action restent dans la page. Rendue statique par défaut, animée seulement
 * si useScene3D l'autorise.
 */
export function HeroScene3D() {
  const ref = useRef<HTMLDivElement>(null);
  const { autorise, anime } = useScene3D(ref);

  // Léger roulis suivant le pointeur (souris uniquement, scène animée).
  useEffect(() => {
    const el = ref.current;
    if (!el || !anime) return;
    let image = 0;
    const suivre = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => {
        const { rx, ry } = inclinaison(e.clientX, e.clientY, el.getBoundingClientRect(), INCLINAISON_MAX);
        el.style.setProperty("--rx", `${rx}deg`);
        el.style.setProperty("--ry", `${ry}deg`);
      });
    };
    const remettre = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    el.addEventListener("pointermove", suivre);
    el.addEventListener("pointerleave", remettre);
    return () => {
      cancelAnimationFrame(image);
      el.removeEventListener("pointermove", suivre);
      el.removeEventListener("pointerleave", remettre);
    };
  }, [anime]);

    return (
    <div ref={ref} className="vitrine-scene" data-autorise={autorise ? "oui" : "non"} data-anime={anime ? "oui" : "non"}>
      <div className="vitrine-monde" aria-hidden="true">
        <div className="vitrine-plan">
          <svg viewBox="0 0 400 300" fill="none" strokeLinecap="round" strokeLinejoin="round">
            {/* Rues : quadrillage discret */}
            <g stroke="rgba(255,255,255,0.07)" strokeWidth="1">
              {[50, 100, 150, 200, 250].map((y) => (
                <path key={`h${y}`} d={`M0 ${y}H400`} />
              ))}
              {[50, 100, 150, 200, 250, 300, 350].map((x) => (
                <path key={`v${x}`} d={`M${x} 0V300`} />
              ))}
            </g>
            <path className="vitrine-route-fond" d={TRACE} strokeWidth="9" />
            <path className="vitrine-route" d={TRACE} pathLength={1} strokeWidth="5" strokeDasharray="1" strokeDashoffset="0" />
            {ARRETS.map((a, i) => {
              const dernierArret = i === ARRETS.length - 1;
              return (
                <g key={i} className="vitrine-arret" style={{ "--t": PROGRESSION[i] } as React.CSSProperties}>
                  {!dernierArret && <circle className="vitrine-arret-anneau" cx={a.x} cy={a.y} r="9" strokeWidth="2" style={{ "--t": PROGRESSION[i] } as React.CSSProperties} />}
                  <circle cx={a.x} cy={a.y} r={dernierArret ? 11 : 7} fill={dernierArret ? "#FF6B35" : "#0A0F1E"} stroke={dernierArret ? "#F0F4FF" : "#1BE4C1"} strokeWidth="3.5" />
                </g>
              );
            })}
          </svg>

          {/* Camion : caisse, cabine, châssis */}
          <div className="vitrine-flotte" style={{ position: "absolute", inset: 0 }}>
            <Pave3D x="6%" y="58%" l={4} p={6} h={5.2} z={1.2} teinte="teal" />
            <Pave3D x="10.6%" y="57%" l={10} p={7} h={6.4} z={1.2} teinte="blanc" />
            <Pave3D x="5.5%" y="57.5%" l={15} p={7} h={1.2} z={0} teinte="ardoise" />
          </div>
          {/* Colis aux arrêts */}
          <div className="vitrine-flotte" style={{ position: "absolute", inset: 0, ["--d" as string]: -1.2 }}>
            <Pave3D x={`${(ARRETS[2]!.x / 400) * 100 - 2}%`} y={`${(ARRETS[2]!.y / 300) * 100 - 14}%`} l={4} p={4} h={4} z={1} teinte="orange" />
          </div>
          <div className="vitrine-flotte" style={{ position: "absolute", inset: 0, ["--d" as string]: -2.4 }}>
            <Pave3D x={`${(ARRETS[4]!.x / 400) * 100 - 2}%`} y={`${(ARRETS[4]!.y / 300) * 100 - 15}%`} l={3.4} p={3.4} h={3.4} z={1} teinte="teal" />
            <Pave3D x={`${(ARRETS[5]!.x / 400) * 100 - 3}%`} y={`${(ARRETS[5]!.y / 300) * 100 - 20}%`} l={5} p={5} h={5} z={2} teinte="orange" />
          </div>
        </div>

        <div className="vitrine-ecran">
          <Image
            src="/home/scene-carburant.png"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 320px, 60vw"
            className="object-cover object-center"
          />
        </div>

        <div className="vitrine-puce hidden items-center gap-3 rounded-2xl bg-surface p-3 pr-4 text-navy shadow-pop sm:flex" style={{ fontSize: "1rem" }}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal text-marine">
            <IconCoins className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-bold">Plein éligible · TICPE calculée</span>
            <span className="block text-xs text-navy/60">Justificatif rangé, prêt pour la déclaration</span>
          </span>
        </div>
      </div>
    </div>
  );
}
