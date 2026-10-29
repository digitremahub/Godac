"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ONGLETS = [
  { href: "/godac-staff", libelle: "Organisations", exact: true },
  { href: "/godac-staff/comptes-essai", libelle: "Comptes d'essai" },
  { href: "/godac-staff/usage-essais", libelle: "Usage des essais" },
  { href: "/godac-staff/go-navigation", libelle: "Invitations GO" },
  { href: "/godac-staff/recommandations", libelle: "Recommandations" },
  { href: "/godac-staff/ticpe", libelle: "Barème TICPE" },
];

/** Barre fixe du back-office GODAC : retour au tableau de bord et onglets, sur toutes les pages. */
export function NavigationStaff() {
  const chemin = usePathname() ?? "";
  return (
    <nav aria-label="Back-office GODAC" className="sticky top-0 z-30 border-b border-navy/10 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <Link href="/dashboard" className="btn-secondary !px-3 !py-1.5 text-sm">
          ← Retour au tableau de bord
        </Link>
        <ul className="flex flex-1 flex-wrap items-center gap-1">
          {ONGLETS.map((o) => {
            const actif = o.exact ? chemin === o.href : chemin === o.href || chemin.startsWith(`${o.href}/`);
            return (
              <li key={o.href}>
                <Link href={o.href} aria-current={actif ? "page" : undefined} className={`inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm ${actif ? "bg-navy font-semibold text-white" : "text-navy hover:bg-navy/5"}`}>
                  {o.libelle}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
