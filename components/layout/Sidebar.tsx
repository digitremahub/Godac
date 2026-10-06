"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/types/domain";
import {
  IconGrid,
  IconDroplet,
  IconPlusCircle,
  IconCamera,
  IconCylinder,
  IconImage,
  IconTruck,
  IconWrench,
  IconCalendar,
  IconMegaphone,
  IconBell,
  IconFileText,
  IconBuilding,
  IconCreditCard,
  IconUsers,
  IconUserCircle,
  IconUpload,
  IconClock,
  IconFlag,
  IconQrCode,
  IconLifeBuoy,
  IconCoins,
} from "@/components/layout/icons";
import { textSafeVariant } from "@/lib/theme/contrast";

interface NavItem {
  href: string;
  label: string;
  allow: UserRole[];
  icon: (props: { className?: string }) => React.ReactNode;
  /** Hidden when the org hasn't enabled this module. Omitted for core (always-on) items. */
  moduleKey?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: "Général",
    items: [
      { href: "/dashboard", label: "Tableau de bord", icon: IconGrid, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"] },
    ],
  },
  {
    label: "Exploitation",
    items: [
      { href: "/fuel", label: "Carburant", icon: IconDroplet, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"] },
      { href: "/fuel/new", label: "Nouveau ravitaillement", icon: IconPlusCircle, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"] },
      { href: "/ocr-review", label: "Revue OCR", icon: IconCamera, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "ocr" },
      { href: "/tanks", label: "Cuves", icon: IconCylinder, allow: ["chauffeur", "manager", "manager_chauffeur", "direction", "comptable"] },
      { href: "/tanks/photos", label: "Photos de cuves", icon: IconImage, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"] },
      { href: "/tanks/deliveries", label: "Approvisionnements", icon: IconUpload, allow: ["manager", "manager_chauffeur", "direction", "comptable"] },
      { href: "/vehicles", label: "Flotte", icon: IconTruck, allow: ["manager", "manager_chauffeur", "direction", "comptable"], moduleKey: "fleet" },
      { href: "/my-vehicle", label: "Mon véhicule", icon: IconTruck, allow: ["chauffeur", "manager_chauffeur"] },
      { href: "/qr-codes", label: "Badges QR", icon: IconQrCode, allow: ["manager", "manager_chauffeur", "direction"] },
      { href: "/maintenance", label: "Demandes d'entretien", icon: IconWrench, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "maintenance_requests" },
      { href: "/tours/start", label: "Démarrer une tournée", icon: IconClock, allow: ["chauffeur", "manager_chauffeur"], moduleKey: "planning" },
      { href: "/tours/end", label: "Terminer une tournée", icon: IconFlag, allow: ["chauffeur", "manager_chauffeur"], moduleKey: "planning" },
      { href: "/planning/mine", label: "Mon planning", icon: IconCalendar, allow: ["chauffeur", "manager_chauffeur"], moduleKey: "planning" },
      { href: "/planning", label: "Planning", icon: IconCalendar, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "planning" },
      { href: "/tours/history", label: "Historique des tournées", icon: IconClock, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "planning" },
    ],
  },
  {
    label: "Équipe",
    items: [
      { href: "/leaves", label: "Congés & Absences", icon: IconCalendar, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "leave_management" },
      { href: "/leaves/planning", label: "Planning congés", icon: IconCalendar, allow: ["direction"], moduleKey: "leave_management" },
      { href: "/intranet", label: "Intranet & Convocations", icon: IconMegaphone, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"], moduleKey: "intranet" },
      { href: "/driver-signups", label: "Chauffeurs à valider", icon: IconUsers, allow: ["manager", "manager_chauffeur", "direction"] },
    ],
  },
  {
    label: "Pilotage",
    items: [
      { href: "/alerts", label: "Alertes", icon: IconBell, allow: ["chauffeur", "manager", "manager_chauffeur", "direction", "comptable"] },
      { href: "/reports", label: "Rapports de tournée", icon: IconFileText, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "planning" },
      { href: "/payroll", label: "Salaires", icon: IconCoins, allow: ["direction"], moduleKey: "planning" },
      { href: "/ticpe", label: "Export TICPE", icon: IconFileText, allow: ["comptable", "direction"], moduleKey: "ticpe_export" },
      { href: "/fines", label: "Amendes", icon: IconFileText, allow: ["direction"], moduleKey: "fines" },
      { href: "/support", label: "Demandes d'assistance", icon: IconLifeBuoy, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "assistant" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/organizations", label: "Organisation", icon: IconBuilding, allow: ["direction"] },
      { href: "/admin/billing", label: "Abonnement", icon: IconCreditCard, allow: ["direction"] },
      { href: "/admin/users", label: "Utilisateurs", icon: IconUsers, allow: ["direction"] },
    ],
  },
  {
    label: "",
    items: [
      { href: "/account", label: "Mon compte", icon: IconUserCircle, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"] },
    ],
  },
];

export function Sidebar({
  role,
  enabledModuleKeys,
  organizationName,
  logoUrl,
  accentColor,
  open = false,
  onNavigate,
}: {
  role: UserRole;
  enabledModuleKeys: string[];
  organizationName?: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  /** Mobile drawer state (ignored at `lg` and above, where the sidebar is always visible). */
  open?: boolean;
  /** Called when a nav link is tapped — the mobile shell closes the drawer on it. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const enabled = new Set(enabledModuleKeys);
  const accent = accentColor || "#1BE4C1";
  // A custom accent color is only guaranteed contrast-safe as a fill
  // (the bar, the logo square below) — used directly as the active
  // nav item's text/icon color, an arbitrary pick could fail contrast
  // against the light background.
  const accentText = textSafeVariant(accent);

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.allow.includes(role) && (!item.moduleKey || enabled.has(item.moduleKey))),
  })).filter((section) => section.items.length > 0);

  // Most-specific-href-wins, so /tanks/photos doesn't also light up
  // the plain /tanks entry it happens to prefix.
  const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  const activeHref = allHrefs
    .filter((href) => (href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav
      className={`fixed inset-y-0 left-0 z-50 flex h-full w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-navy/10 bg-white/95 p-4 backdrop-blur-sm transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:w-64 lg:translate-x-0 lg:bg-white/70 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <Link href="/dashboard" title="Accueil" className="flex items-center gap-2.5 px-2 pt-1" onClick={onNavigate}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={organizationName ?? "Logo"} className="h-9 w-9 rounded-lg object-contain ring-1 ring-navy/10" />
        ) : (
          <div
            className="h-9 w-9 rounded-lg shadow-[0_2px_10px_-2px_var(--tw-shadow-color)]"
            style={{ backgroundColor: accent, "--tw-shadow-color": `${accent}80` } as React.CSSProperties}
          />
        )}
        <span className="truncate font-display text-lg font-extrabold leading-tight">{organizationName ?? "GODAC"}</span>
      </Link>

      {sections.map((section, i) => (
        <div key={i} className="flex flex-col gap-1">
          {section.label && <p className="kicker px-3 pb-1">{section.label}</p>}
          {section.items.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`group relative flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                  active ? "bg-navy/[0.08]" : "text-navy/60 hover:bg-navy/[0.05] hover:text-navy"
                }`}
                style={active ? { color: accentText } : undefined}
              >
                {active && (
                  <span className="absolute -left-4 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full" style={{ backgroundColor: accent }} />
                )}
                <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${active ? "" : "text-navy/35 group-hover:text-navy/60"}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
