"use client";

import { useEffect, useRef } from "react";
import { IconArrowRight } from "@/components/layout/icons";
import { IllustrationModule, type CleIllustration } from "@/components/marketing/IllustrationsModules";
import { useScene3D } from "@/components/marketing/useScene3D";
import { decalageParallaxe, inclinaison } from "@/lib/vitrine/scene";

/** Un module par carte, dans l'ordre de la vitrine : TICPE d'abord, GO Navigation en dernier. */
const MODULES: { cle: CleIllustration; href: string; titre: string; texte: string; profondeur: number }[] = [
  { cle: "ticpe", href: "#ticpe", titre: "TICPE", texte: "Vos camions éligibles repérés, le remboursement chiffré plein par plein.", profondeur: 10 },
  { cle: "carburant", href: "#carburant", titre: "Carburant", texte: "Chaque litre tracé de la cuve au ticket, sans ressaisie.", profondeur: 26 },
  { cle: "flotte", href: "#flotte", titre: "Flotte", texte: "Vos véhicules suivis, de la carte grise à l’amende.", profondeur: 10 },
  { cle: "planning", href: "#planning-paie", titre: "Planning, RH & paie", texte: "Du planning au bulletin, sans ressaisie.", profondeur: 26 },
  { cle: "colis", href: "#tournee-colis", titre: "Tournée colis", texte: "Arrêts, ramasses et preuves de livraison dans le même écran.", profondeur: 10 },
  { cle: "go", href: "#go-navigation", titre: "GO Navigation", texte: "Le GPS pensé pour la tournée, en avant-première.", profondeur: 26 },
];

const INCLINAISON_MAX = 9;

/**
 * Une carte par module, avec une illustration empilée en profondeur.
 * Effets (parallaxe au défilement, inclinaison au pointeur ou au
 * gyroscope) uniquement quand useScene3D les autorise ; sinon des cartes
 * à plat, entièrement lisibles et cliquables.
 */
export function ModulesProfondeur() {
  const liste = useRef<HTMLUListElement>(null);
  const { anime } = useScene3D(liste);

  useEffect(() => {
    const ul = liste.current;
    if (!ul || !anime) return;
    const cartes = Array.from(ul.querySelectorAll<HTMLElement>("[data-profondeur]"));

    // Parallaxe : décalage vertical selon la position dans la fenêtre.
    let image = 0;
    const defiler = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => {
        const echelle = window.innerWidth < 640 ? 0.4 : 1;
        for (const c of cartes) {
          const r = c.getBoundingClientRect();
          const dy = decalageParallaxe(r.top - Number(c.dataset.dy || 0), r.height, window.innerHeight, Number(c.dataset.profondeur) * echelle);
          c.dataset.dy = String(dy);
          c.style.setProperty("--dy", `${dy}px`);
        }
      });
    };
    defiler();
    window.addEventListener("scroll", defiler, { passive: true });
    window.addEventListener("resize", defiler);

    // Gyroscope facultatif (Android et navigateurs sans demande de permission ;
    // iOS exige un geste, on s'abstient).
    const Orientation = window.DeviceOrientationEvent as (typeof DeviceOrientationEvent & { requestPermission?: unknown }) | undefined;
    const tactile = window.matchMedia("(pointer: coarse)").matches;
    let gyro: ((e: DeviceOrientationEvent) => void) | null = null;
    if (tactile && Orientation && typeof Orientation.requestPermission !== "function") {
      gyro = (e) => {
        const ry = Math.max(-INCLINAISON_MAX, Math.min(INCLINAISON_MAX, (e.gamma ?? 0) / 4));
        const rx = Math.max(-INCLINAISON_MAX, Math.min(INCLINAISON_MAX, -((e.beta ?? 45) - 45) / 4));
        for (const c of cartes) {
          const face = c.firstElementChild as HTMLElement | null;
          face?.style.setProperty("--rx", `${Math.round(rx * 10) / 10}deg`);
          face?.style.setProperty("--ry", `${Math.round(ry * 10) / 10}deg`);
        }
      };
      window.addEventListener("deviceorientation", gyro);
    }

    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener("scroll", defiler);
      window.removeEventListener("resize", defiler);
      if (gyro) window.removeEventListener("deviceorientation", gyro);
      for (const c of cartes) c.style.removeProperty("--dy");
    };
  }, [anime]);

  function pencher(e: React.PointerEvent<HTMLLIElement>) {
    if (!anime || e.pointerType !== "mouse") return;
    const face = e.currentTarget.firstElementChild as HTMLElement | null;
    if (!face) return;
    const { rx, ry } = inclinaison(e.clientX, e.clientY, face.getBoundingClientRect(), INCLINAISON_MAX);
    face.style.setProperty("--rx", `${rx}deg`);
    face.style.setProperty("--ry", `${ry}deg`);
  }
  function redresser(e: React.PointerEvent<HTMLLIElement>) {
    const face = e.currentTarget.firstElementChild as HTMLElement | null;
    face?.style.setProperty("--rx", "0deg");
    face?.style.setProperty("--ry", "0deg");
  }

  return (
    <ul ref={liste} className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {MODULES.map((m) => (
        <li key={m.cle} className="vitrine-carte" data-profondeur={m.profondeur} onPointerMove={pencher} onPointerLeave={redresser}>
          <a href={m.href} className="vitrine-carte-face card card-hover flex h-full flex-col gap-3 hover:border-teal-ink/40">
            <IllustrationModule cle={m.cle} />
            <h3 className="text-lg">{m.titre}</h3>
            <p className="text-pretty text-sm leading-relaxed text-navy/65">{m.texte}</p>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-teal-ink">
              Voir le détail
              <IconArrowRight className="h-4 w-4" />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
