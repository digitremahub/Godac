"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconMenu, IconX } from "@/components/layout/icons";

export interface LienMenu {
  href: string;
  label: string;
}

/** Menu déroulant de l'en-tête public sur mobile (liens masqués sous 1024 px). */
export function MenuMobile({ liens }: { liens: LienMenu[] }) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const fermerAuClavier = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    const fermerAuClicExterieur = (e: PointerEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("keydown", fermerAuClavier);
    document.addEventListener("pointerdown", fermerAuClicExterieur);
    return () => {
      document.removeEventListener("keydown", fermerAuClavier);
      document.removeEventListener("pointerdown", fermerAuClicExterieur);
    };
  }, [ouvert]);

  return (
    <div ref={racine} className="lg:hidden">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        aria-controls="menu-public"
        aria-label={ouvert ? "Fermer le menu" : "Ouvrir le menu"}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-white/85 hover:bg-white/10 hover:text-white focus-visible:outline-teal"
      >
        {ouvert ? <IconX className="h-5 w-5" /> : <IconMenu className="h-5 w-5" />}
      </button>
      {ouvert && (
        <nav id="menu-public" aria-label="Menu du site" className="absolute inset-x-3 top-full mt-2 rounded-2xl border border-white/10 bg-marine p-2 shadow-pop">
          <ul className="flex flex-col">
            {liens.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOuvert(false)} className="flex min-h-11 items-center rounded-xl px-3 text-base font-medium text-white/85 hover:bg-white/10 hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
