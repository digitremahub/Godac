"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ONGLETS = [
  { href: "/colis", label: "Tournée colis" },
  { href: "/suivi", label: "Suivi en direct" },
  { href: "/colis?onglet=historique", label: "Historique colis", activePath: "/colis" },
  { href: "/tours/routes", label: "Tournées villages" },
  { href: "/tours/history", label: "Historique planning" },
] as const;

/** Navigation unifiée entre les vues opérationnelles de tournée. */
export function TourneesTabs() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Tournées colis" className="mb-5 overflow-x-auto border-b border-navy/10">
      <div className="flex min-w-max gap-1" role="tablist" aria-label="Vues des tournées">
        {ONGLETS.map((onglet) => {
          const active = pathname === onglet.activePath
            ? false
            : pathname === onglet.href.split("?")[0];
          return (
            <Link
              key={onglet.label}
              href={onglet.href}
              role="tab"
              aria-selected={active}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${active ? "border-teal text-navy" : "border-transparent text-navy/55 hover:text-navy"}`}
            >
              {onglet.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
