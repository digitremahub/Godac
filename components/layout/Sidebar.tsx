"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/types/domain";
import {
  IconGrid,
  IconDroplet,
  IconCamera,
  IconCylinder,
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
  IconClock,
  IconFlag,
  IconQrCode,
  IconLifeBuoy,
  IconCoins,
  IconChatBubble,
  IconChartBar,
  IconMapPin,
  IconShieldCheck,
} from "@/components/layout/icons";

interface NavItem {
  href: string;
  label: string;
  allow: UserRole[];
  icon: (props: { className?: string }) => React.ReactNode;
  /** Hidden when the org hasn't enabled this module. Omitted for core (always-on) items. */
  moduleKey?: string;
  /** Hidden when the org HAS enabled this module (an entry another one replaces). */
  unlessModuleKey?: string;
  /** Other routes that belong to this entry (tabs of the same page). */
  alsoActive?: string[];
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
      // "Nouveau ravitaillement" vit maintenant sur /fuel?new=1 (bouton
      // "+ Nouveau ravitaillement" sur la page Carburant elle-même,
      // visible manager/manager_chauffeur/direction) — plus d'entrée de
      // nav séparée.
      { href: "/ocr-review", label: "Revue OCR", icon: IconCamera, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "ocr" },
      { href: "/tanks", label: "Cuves & Approvisionnements", icon: IconCylinder, allow: ["manager", "manager_chauffeur", "direction", "comptable"] },
      { href: "/vehicles", label: "Flotte", icon: IconTruck, allow: ["manager", "manager_chauffeur", "direction", "comptable"], moduleKey: "fleet" },
      { href: "/my-vehicle", label: "Mon véhicule", icon: IconTruck, allow: ["chauffeur", "manager_chauffeur"] },
      { href: "/qr-codes", label: "Badges QR", icon: IconQrCode, allow: ["manager", "manager_chauffeur", "direction"] },
      { href: "/maintenance", label: "Demandes d'entretien", icon: IconWrench, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "maintenance_requests" },
      { href: "/loueurs/demandes", label: "Demandes aux loueurs", icon: IconWrench, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "rental_providers" },
      { href: "/loueurs", label: "Loueurs & prestataires", icon: IconBuilding, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "rental_providers" },
      { href: "/tours/start", label: "Démarrer une tournée", icon: IconClock, allow: ["chauffeur", "manager_chauffeur"], moduleKey: "planning" },
      { href: "/tours/end", label: "Terminer une tournée", icon: IconFlag, allow: ["chauffeur", "manager_chauffeur"], moduleKey: "planning" },
      { href: "/tours/help", label: "J'entre pour un collègue", icon: IconUsers, allow: ["chauffeur", "manager_chauffeur"] },
      { href: "/planning/mine", label: "Mon planning", icon: IconCalendar, allow: ["chauffeur", "manager_chauffeur"], moduleKey: "planning" },
      { href: "/planning", label: "Planning", icon: IconCalendar, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "planning" },
      { href: "/suivi", label: "Suivi des tournées", icon: IconMapPin, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "route_optimizer" },
      { href: "/colis", label: "Tournée colis", icon: IconQrCode, allow: ["chauffeur", "manager_chauffeur"], moduleKey: "route_optimizer" },
      { href: "/tours/routes", label: "Tournées & villages", icon: IconMapPin, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "planning" },
      { href: "/tours/history", label: "Historique des tournées", icon: IconClock, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "planning" },
    ],
  },
  {
    label: "Équipe",
    items: [
      { href: "/leaves", label: "Congés & Absences", icon: IconCalendar, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "leave_management" },
      { href: "/leaves/planning", label: "Planning congés", icon: IconCalendar, allow: ["direction"], moduleKey: "leave_management" },
      { href: "/intranet", label: "Intranet & Convocations", icon: IconMegaphone, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"], moduleKey: "intranet" },
      { href: "/messenger", label: "Messenger", icon: IconChatBubble, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"], moduleKey: "messenger" },
      { href: "/time-clock", label: "Pointeuse", icon: IconClock, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"], moduleKey: "time_clock" },
      { href: "/payslips", label: "Fiches de paie", icon: IconCoins, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable"], moduleKey: "payslips" },
      { href: "/driver-signups", label: "Chauffeurs à valider", icon: IconUsers, allow: ["manager", "manager_chauffeur", "direction"] },
    ],
  },
  {
    label: "Pilotage",
    items: [
      { href: "/alerts", label: "Alertes", icon: IconBell, allow: ["chauffeur", "manager", "manager_chauffeur", "direction", "comptable"] },
      { href: "/reports", label: "Rapports de tournée", icon: IconFileText, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "planning" },
      // Paie, salaires et fiches de paie : une seule page à onglets (components/paie/OngletsPaie.tsx).
      { href: "/paie", label: "Paie & salaires", icon: IconCoins, allow: ["direction"], moduleKey: "payslips", alsoActive: ["/payroll", "/payslips"] },
      { href: "/payroll", label: "Salaires", icon: IconCoins, allow: ["direction"], moduleKey: "planning", unlessModuleKey: "payslips" },
      { href: "/ticpe", label: "Export TICPE", icon: IconFileText, allow: ["comptable", "direction"], moduleKey: "ticpe_export" },
      { href: "/contestations", label: "Contestations clients", icon: IconFileText, allow: ["chauffeur", "manager", "manager_chauffeur", "direction"], moduleKey: "customer_disputes" },
      { href: "/mes-amendes", label: "Mes amendes", icon: IconFileText, allow: ["chauffeur", "manager_chauffeur"], moduleKey: "fines" },
      { href: "/fines", label: "Amendes", icon: IconFileText, allow: ["direction"], moduleKey: "fines" },
      { href: "/support", label: "Demandes d'assistance", icon: IconLifeBuoy, allow: ["manager", "manager_chauffeur", "direction"], moduleKey: "assistant" },
      { href: "/reporting", label: "Reporting BI", icon: IconChartBar, allow: ["direction"], moduleKey: "bi_reporting" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/organizations", label: "Organisation", icon: IconBuilding, allow: ["direction"] },
      { href: "/admin/billing", label: "Abonnement", icon: IconCreditCard, allow: ["direction"] },
      { href: "/admin/users", label: "Utilisateurs", icon: IconUsers, allow: ["direction"] },
      { href: "/admin/journal", label: "Journal d'audit", icon: IconShieldCheck, allow: ["direction"] },
    ],
  },
  {
    label: "",
    items: [
      { href: "/guide", label: "Guide d'utilisation", icon: IconFileText, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"] },
      { href: "/faq", label: "Questions fréquentes", icon: IconLifeBuoy, allow: ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"] },
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
  // The org's accent is only ever used as a fill here (logo square,
  // active indicator) — the sidebar is navy, so text stays white.
  const accent = accentColor || "#1BE4C1";

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        item.allow.includes(role) &&
        (!item.moduleKey || enabled.has(item.moduleKey)) &&
        (!item.unlessModuleKey || !enabled.has(item.unlessModuleKey)),
    ),
  })).filter((section) => section.items.length > 0);

  // Most-specific-href-wins, so a nested route doesn't also light up
  // a shorter entry it happens to prefix.
  const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  const matches = (href: string) => (href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const activeHref =
    allHrefs.filter(matches).sort((a, b) => b.length - a.length)[0] ??
    sections.flatMap((s) => s.items).find((i) => i.alsoActive?.some(matches))?.href;

  return (
    <nav
      id="navigation-principale"
      aria-label="Navigation principale"
      // Off-canvas on mobile: `invisible` (delayed until the slide-out
      // finishes) takes the closed drawer's links out of the tab order
      // and the accessibility tree, not just off-screen.
      className={`sidebar-scroll fixed inset-y-0 left-0 z-50 flex h-full w-72 shrink-0 flex-col gap-6 overflow-y-auto overscroll-contain border-r border-white/[0.06] bg-marine px-3 pb-6 pt-4 text-white transition-[transform,visibility] duration-200 ease-in-out lg:visible lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:translate-x-0 ${
        open ? "visible translate-x-0" : "invisible -translate-x-full"
      }`}
    >
      <Link href="/dashboard" title="Accueil" className="flex items-center gap-3 rounded-xl px-2 py-1.5" onClick={onNavigate}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" width={36} height={36} className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/brand/godac-symbol.svg" alt="" width={43} height={36} className="h-9 w-auto shrink-0" />
        )}
        <span className="min-w-0">
          <span className="block truncate font-display text-[15px] font-bold leading-tight">{organizationName ?? "GODAC"}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/godac-wordmark-white.svg" alt="GODAC" width={51} height={10} className="mt-1 block h-2.5 w-auto opacity-70" />
        </span>
      </Link>

      {sections.map((section, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {section.label && <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">{section.label}</p>}
          {section.items.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`group relative flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 lg:min-h-[38px] ${
                  active ? "bg-white/[0.1] text-white" : "text-white/75 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {active && (
                  <span aria-hidden="true" className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full" style={{ backgroundColor: accent }} />
                )}
                <span style={active ? { color: accent } : undefined} className={`shrink-0 transition-colors ${active ? "" : "text-white/55 group-hover:text-white/80"}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
