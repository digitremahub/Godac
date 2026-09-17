"use client";

import { useEffect, useState } from "react";
import { IconCamera, IconBell, IconTruck, IconFileText } from "@/components/layout/icons";

interface Scene {
  icon: (props: { className?: string }) => React.ReactNode;
  title: string;
  description: string;
  accent: "teal" | "orange" | "gold";
}

const SCENES: Scene[] = [
  {
    icon: IconCamera,
    title: "Le chauffeur scanne son ravitaillement",
    description: "QR sur la pompe ou photo du ticket : le plein est enregistré et le PMP recalculé automatiquement.",
    accent: "teal",
  },
  {
    icon: IconBell,
    title: "GODAC surveille les écarts",
    description: "Un écart de totaliseur ou une anomalie de cuve remonte en alerte avant de devenir un vrai problème.",
    accent: "orange",
  },
  {
    icon: IconTruck,
    title: "Toute l'équipe au même endroit",
    description: "Flotte, entretien, congés et intranet centralisés — chacun voit ce qui le concerne, selon son rôle.",
    accent: "gold",
  },
  {
    icon: IconFileText,
    title: "L'export TICPE part en un clic",
    description: "Filtré PL/SPL automatiquement, en self-service pour le rôle comptable, sans ressaisie.",
    accent: "teal",
  },
];

const ACCENT_CLASSES: Record<Scene["accent"], { bg: string; text: string; ring: string }> = {
  teal: { bg: "bg-teal/10", text: "text-teal-ink", ring: "ring-teal/25" },
  orange: { bg: "bg-orange/10", text: "text-orange-ink", ring: "ring-orange/25" },
  gold: { bg: "bg-gold/10", text: "text-gold-ink", ring: "ring-gold/25" },
};

const SCENE_DURATION_MS = 4500;

/**
 * Stand-in for a product demo video: an auto-advancing, illustrated
 * walkthrough of GODAC's core loop (scan -> alert -> team -> export).
 * No video asset exists yet, so this fills the same explanatory role
 * on the homepage until a real recording replaces it — same section,
 * just swap this component out then.
 */
export function ExplainerAnimation() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const id = setInterval(() => {
      setActive((i) => (i + 1) % SCENES.length);
    }, SCENE_DURATION_MS);
    return () => clearInterval(id);
  }, [paused]);

  const scene = SCENES[active] ?? SCENES[0]!;
  const Icon = scene.icon;
  const accent = ACCENT_CLASSES[scene.accent];

  return (
    <div
      className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-[0_20px_60px_-25px_rgba(10,15,30,0.25)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-1.5 border-b border-navy/10 bg-navy/[0.03] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
        <span className="ml-3 text-xs text-navy/40">GODAC — comment ça marche</span>
      </div>

      <div className="flex min-h-[280px] flex-col items-center justify-center gap-5 px-8 py-12 text-center sm:min-h-[320px]">
        <div key={active} className="flex flex-col items-center gap-5 animate-[explainer-in_0.5s_ease-out]">
          <span className={`flex h-16 w-16 items-center justify-center rounded-2xl ${accent.bg} ring-1 ${accent.ring}`}>
            <Icon className={`h-7 w-7 ${accent.text}`} />
          </span>
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-xl font-extrabold sm:text-2xl">{scene.title}</h3>
            <p className="max-w-md text-sm text-navy/60 sm:text-base">{scene.description}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-navy/10 py-4">
        {SCENES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-label={`Voir : ${s.title}`}
            onClick={() => setActive(i)}
            className={`h-1.5 rounded-full transition-all ${i === active ? "w-6 bg-teal" : "w-1.5 bg-navy/15 hover:bg-navy/25"}`}
          />
        ))}
      </div>
    </div>
  );
}
