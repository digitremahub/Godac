"use client";

import Link from "next/link";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { RechercheGlobale } from "@/components/layout/RechercheGlobale";
import { IconExternal, IconMenu } from "@/components/layout/icons";
import { VITRINE_URL } from "@/lib/domaines/routage";
import type { UserRole } from "@/lib/types/domain";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

export function TopBar({
  fullName,
  role,
  roleTitle,
  onMenuClick,
  goNavigation = false,
}: {
  fullName: string;
  role: UserRole;
  roleTitle?: string | null;
  onMenuClick?: () => void;
  /** Compte d'essai GO Navigation : pas de lien vers le centre de notifications. */
  goNavigation?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-navy/[0.08] bg-surface/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Ouvrir le menu"
          aria-controls="navigation-principale"
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-navy/70 transition-colors hover:bg-navy/[0.06] hover:text-navy lg:hidden"
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <a
          href={VITRINE_URL}
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-navy/65 transition-colors hover:bg-navy/[0.05] hover:text-navy md:inline-flex"
        >
          Site vitrine
          <IconExternal className="h-3.5 w-3.5" />
          <span className="sr-only"> (nouvel onglet)</span>
        </a>
      </div>

      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        {!goNavigation && <RechercheGlobale />}
        <NotificationBell lienToutes={!goNavigation} />
        <Link href="/account" className="flex min-w-0 items-center gap-3 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-navy/[0.04]">
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marine text-[13px] font-bold text-teal-sur-menu"
          >
            {initials(fullName)}
          </div>
          <div className="hidden min-w-0 text-left sm:block">
            <p className="truncate text-sm font-semibold leading-tight">{fullName}</p>
            <p className="truncate text-xs text-navy/60">
              {ROLE_LABELS[role]}
              {roleTitle ? ` · ${roleTitle}` : ""}
            </p>
          </div>
        </Link>
        <span aria-hidden="true" className="hidden h-6 w-px bg-navy/10 sm:block" />
        <SignOutButton />
      </div>
    </header>
  );
}
