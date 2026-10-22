"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { UserRole } from "@/lib/types/domain";
import { entreeActive, estSectionRepliee, menuAffiche, type IconeId, type SectionId } from "@/lib/acces/catalogue";
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
  IconNavigation,
} from "@/components/layout/icons";

export const ICONES: Record<IconeId, (props: { className?: string }) => React.ReactNode> = {
  grid: IconGrid,
  chart: IconChartBar,
  clock: IconClock,
  flag: IconFlag,
  users: IconUsers,
  calendar: IconCalendar,
  truck: IconTruck,
  file: IconFileText,
  coins: IconCoins,
  wrench: IconWrench,
  map: IconMapPin,
  qr: IconQrCode,
  building: IconBuilding,
  droplet: IconDroplet,
  camera: IconCamera,
  cylinder: IconCylinder,
  megaphone: IconMegaphone,
  chat: IconChatBubble,
  bell: IconBell,
  lifebuoy: IconLifeBuoy,
  card: IconCreditCard,
  shield: IconShieldCheck,
  navigation: IconNavigation,
  user: IconUserCircle,
};

const MEMO_DEPLIEES = "godac-menu-sections-depliees";
const MEMO_SECTIONS = "godac-menu-sections";

/**
 * Menu latéral généré depuis le catalogue (lib/acces/catalogue.ts) :
 * sections Tableau de bord, Mon espace, Exploitation, Flotte, Carburant,
 * Équipe & RH, Communication, Administration, Aide. Une entrée n'apparaît
 * que si le rôle peut ouvrir l'écran et que ses modules sont actifs ;
 * une section vide est masquée ; une même page n'apparaît qu'une fois.
 */
export function Sidebar({
  role,
  conduit = role === "chauffeur",
  enabledModuleKeys,
  organizationName,
  logoUrl,
  accentColor,
  open = false,
  onNavigate,
}: {
  role: UserRole;
  /** Chauffeur, ou manager qui conduit aussi : entrées « Mon espace » de conduite. */
  conduit?: boolean;
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
  // The org's accent is only ever used as a fill here (logo square,
  // active indicator) — the sidebar is navy, so text stays white.
  const accent = accentColor || "#1BE4C1";

  // « Mon espace » réduit à ses trois onglets, « Mes tournées » pour le chauffeur.
  const sections = menuAffiche(role, new Set(enabledModuleKeys), conduit);
  const active = entreeActive(
    sections.flatMap((s) => s.ecrans),
    pathname,
  );
  // Toutes les sections se replient d'un clic sur leur titre. Par défaut,
  // Administration et Aide sont repliées pour la direction et les autres
  // ouvertes (ou ouvertes quand l'écran affiché s'y trouve) ; le choix de
  // l'utilisateur l'emporte ensuite et est mémorisé sur cet appareil.
  const [choix, setChoix] = useState<Partial<Record<SectionId, boolean>>>({});
  useEffect(() => {
    try {
      const memo = JSON.parse(localStorage.getItem(MEMO_SECTIONS) ?? "null");
      if (memo && typeof memo === "object" && !Array.isArray(memo)) {
        setChoix(memo as Partial<Record<SectionId, boolean>>);
        return;
      }
      // Ancien format : liste des sections dépliées.
      const ancien = JSON.parse(localStorage.getItem(MEMO_DEPLIEES) ?? "[]");
      if (Array.isArray(ancien)) setChoix(Object.fromEntries((ancien as SectionId[]).map((id) => [id, true])));
    } catch {
      /* stockage indisponible */
    }
  }, []);
  function basculer(id: SectionId, ouverte: boolean) {
    setChoix((c) => {
      const n = { ...c, [id]: !ouverte };
      try {
        localStorage.setItem(MEMO_SECTIONS, JSON.stringify(n));
      } catch {
        /* stockage indisponible */
      }
      return n;
    });
  }

  return (
    <nav
      id="navigation-principale"
      aria-label="Navigation principale"
      // Off-canvas on mobile: `invisible` (delayed until the slide-out
      // finishes) takes the closed drawer's links out of the tab order
      // and the accessibility tree, not just off-screen.
      className={`sidebar-scroll fixed inset-y-0 left-0 z-50 flex h-full w-72 shrink-0 flex-col gap-5 overflow-y-auto overscroll-contain border-r border-white/[0.06] bg-marine px-3 pb-6 pt-4 text-white transition-[transform,visibility] duration-200 ease-in-out lg:visible lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:translate-x-0 ${
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

      {sections.map((section) => {
        const contientActif = section.ecrans.some((e) => e.id === active?.id);
        const ouverte = choix[section.id] ?? (!estSectionRepliee(section.id, role) || contientActif);
        return (
        <div key={section.id} className="flex flex-col gap-0.5" role="group" aria-labelledby={`menu-${section.id}`}>
          <button
            type="button"
            id={`menu-${section.id}`}
            aria-expanded={ouverte}
            aria-controls={`menu-liste-${section.id}`}
            onClick={() => basculer(section.id, ouverte)}
            className={`flex min-h-[44px] items-center justify-between rounded-lg px-3 text-[11px] font-semibold uppercase tracking-[0.14em] hover:bg-white/[0.06] hover:text-white/80 lg:min-h-[32px] ${
              !ouverte && contientActif ? "text-white" : "text-white/60"
            }`}
          >
            {section.libelle}
            <span aria-hidden="true" className="text-sm normal-case tracking-normal">{ouverte ? "▴" : `▾ ${section.ecrans.length}`}</span>
          </button>
          <div id={`menu-liste-${section.id}`} hidden={!ouverte} className="flex flex-col gap-0.5">
          {section.ecrans.map((item) => {
            const estActif = item.id === active?.id;
            const Icon = ICONES[item.icone];
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={onNavigate}
                aria-current={estActif ? "page" : undefined}
                className={`group relative flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 lg:min-h-[38px] ${
                  estActif ? "bg-white/[0.1] text-white" : "text-white/75 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {estActif && (
                  <span aria-hidden="true" className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full" style={{ backgroundColor: accent }} />
                )}
                <span style={estActif ? { color: accent } : undefined} className={`shrink-0 transition-colors ${estActif ? "" : "text-white/55 group-hover:text-white/80"}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="truncate">{item.libelleOnglet ?? item.libelle}</span>
              </Link>
            );
          })}
          </div>
        </div>
        );
      })}
    </nav>
  );
}
