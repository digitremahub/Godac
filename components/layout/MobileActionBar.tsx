"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/types/domain";
import { boutonsBarreMobile, type IconeBarre } from "@/lib/acces/barre-mobile";
import { IconCalendar, IconChatBubble, IconClock, IconFlag, IconMenu, IconPlusCircle, IconQrCode, IconWrench } from "@/components/layout/icons";

const ICONES: Record<IconeBarre, (props: { className?: string }) => React.ReactNode> = {
  depart: IconClock,
  retour: IconFlag,
  plein: IconPlusCircle,
  colis: IconQrCode,
  planning: IconCalendar,
  messages: IconChatBubble,
  signaler: IconWrench,
};

/**
 * Barre fixe des rôles terrain sous `lg` : les 4 gestes quotidiens du
 * chauffeur (tournée, plein, colis, messages) sans ouvrir le menu, et
 * « Plus » qui ouvre le tiroir (Mon espace, Communication, Aide…).
 * Boutons calculés par lib/acces/barre-mobile.ts depuis le catalogue.
 */
export function MobileActionBar({
  role,
  enabledModuleKeys,
  hasActiveTour,
  onPlus,
}: {
  role: UserRole;
  enabledModuleKeys: string[];
  hasActiveTour: boolean;
  /** Ouvre le tiroir du menu. */
  onPlus: () => void;
}) {
  const pathname = usePathname() ?? "";
  const items = boutonsBarreMobile(role, new Set(enabledModuleKeys), hasActiveTour);
  if (items.length === 0) return null;

  const classe = (active: boolean) =>
    `flex min-h-[52px] w-full flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors ${
      active ? "bg-white/10 text-teal" : "text-white/75 active:bg-white/10"
    }`;

  return (
    <nav aria-label="Actions rapides" className="fixed inset-x-3 bottom-3 z-30 lg:hidden" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="flex rounded-2xl bg-marine/95 p-1.5 shadow-pop ring-1 ring-white/10 backdrop-blur-md">
        {items.map((item) => {
          const Icon = ICONES[item.icone];
          const path = item.href.split("?")[0]!;
          const active = pathname === path || pathname.startsWith(`${path}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link href={item.href} aria-current={active ? "page" : undefined} className={classe(active)}>
                <Icon className="h-5 w-5" />
                <span>{item.libelle}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <button type="button" onClick={onPlus} aria-controls="navigation-principale" className={classe(false)}>
            <IconMenu className="h-5 w-5" />
            <span>Plus</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
