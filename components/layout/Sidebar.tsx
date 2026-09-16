"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/types/domain";

interface NavItem {
  href: string;
  label: string;
  allow: UserRole[];
  /** Hidden when the org hasn't enabled this module. Omitted for core (always-on) items. */
  moduleKey?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"] },
  { href: "/fuel", label: "Carburant", allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"] },
  { href: "/fuel/new", label: "Nouveau ravitaillement", allow: ["chauffeur", "manager", "manager_chauffeur", "direction"] },
  { href: "/ocr-review", label: "Revue OCR", allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "ocr" },
  { href: "/tanks", label: "Cuves", allow: ["manager", "manager_chauffeur", "direction", "comptable"] },
  { href: "/vehicles", label: "Flotte", allow: ["manager", "manager_chauffeur", "direction", "comptable"], moduleKey: "fleet" },
  { href: "/maintenance", label: "Demandes d'entretien", allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "maintenance_requests" },
  { href: "/alerts", label: "Alertes", allow: ["manager", "manager_chauffeur", "direction", "comptable"] },
  { href: "/ticpe", label: "Export TICPE", allow: ["comptable", "direction"], moduleKey: "ticpe_export" },
  { href: "/admin/organizations", label: "Organisation", allow: ["direction"] },
  { href: "/admin/billing", label: "Abonnement", allow: ["direction"] },
  { href: "/admin/users", label: "Utilisateurs", allow: ["direction"] },
];

export function Sidebar({ role, enabledModuleKeys }: { role: UserRole; enabledModuleKeys: string[] }) {
  const pathname = usePathname();
  const enabled = new Set(enabledModuleKeys);
  const items = NAV_ITEMS.filter((item) => item.allow.includes(role) && (!item.moduleKey || enabled.has(item.moduleKey)));

  return (
    <nav className="flex h-full w-64 shrink-0 flex-col gap-1 border-r border-white/10 bg-navy/95 p-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="h-8 w-8 rounded-lg bg-teal" />
        <span className="font-display text-xl font-extrabold">GODAC</span>
      </div>
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-teal/15 text-teal" : "text-white/70 hover:bg-white/5 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
