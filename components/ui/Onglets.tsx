"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export interface Onglet {
  href: string;
  libelle: string;
  /** Chemins qui allument aussi cet onglet (sous-pages). */
  prefixes?: readonly string[];
}

/** Onglet actif : le préfixe le plus long qui correspond au chemin courant. */
export function ongletActif(onglets: readonly Onglet[], pathname: string): Onglet | undefined {
  let meilleur: { o: Onglet; n: number } | undefined;
  for (const o of onglets) {
    for (const p of [o.href.split("?")[0]!, ...(o.prefixes ?? [])]) {
      if ((pathname === p || pathname.startsWith(`${p}/`)) && (!meilleur || p.length > meilleur.n)) meilleur = { o, n: p.length };
    }
  }
  return meilleur?.o;
}

/**
 * Composant d'onglets unique de l'espace connecté (barre de section et
 * sous-onglets). Ce sont des liens (chaque onglet a sa propre URL :
 * bouton Retour, partage, notifications), annoncés par `aria-current`.
 * Sur mobile, la barre défile horizontalement et l'onglet actif est
 * ramené dans la vue ; cibles tactiles de 44 px.
 */
export function Onglets({ onglets, libelle, variante = "section" }: { onglets: readonly Onglet[]; libelle: string; variante?: "section" | "sous" }) {
  const pathname = usePathname() ?? "";
  const actif = ongletActif(onglets, pathname);
  const refActif = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    refActif.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [actif?.href]);

  if (onglets.length < 2) return null;

  if (variante === "sous") {
    return (
      <nav aria-label={libelle} className="-mx-1 mb-4 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        <ul className="flex w-max gap-1 rounded-xl bg-navy/[0.04] p-1">
          {onglets.map((o) => {
            const estActif = o === actif;
            return (
              <li key={o.href}>
                <Link
                  ref={estActif ? refActif : undefined}
                  href={o.href}
                  aria-current={estActif ? "page" : undefined}
                  className={`flex min-h-[40px] items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal ${
                    estActif ? "bg-surface text-navy shadow-sm" : "text-navy/65 hover:text-navy"
                  }`}
                >
                  {o.libelle}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={libelle} className="-mx-4 mb-5 overflow-x-auto border-b border-navy/10 px-4 [scrollbar-width:thin] sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1">
        {onglets.map((o) => {
          const estActif = o === actif;
          return (
            <li key={o.href}>
              <Link
                ref={estActif ? refActif : undefined}
                href={o.href}
                aria-current={estActif ? "page" : undefined}
                className={`-mb-px flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ${
                  estActif ? "border-teal text-navy" : "border-transparent text-navy/60 hover:border-navy/20 hover:text-navy"
                }`}
              >
                {o.libelle}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
