"use client";

import Link from "next/link";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { IconGrid, IconMenu } from "@/components/layout/icons";
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
}: {
  fullName: string;
  role: UserRole;
  roleTitle?: string | null;
  onMenuClick?: () => void;
}) {
  return (
    <header className="flex h-16 items-center justify-between gap-3 border-b border-navy/10 bg-white/70 px-4 backdrop-blur-sm sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Ouvrir le menu"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-navy/60 transition-colors hover:bg-navy/[0.06] hover:text-navy lg:hidden"
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <Link
          href="/dashboard"
          title="Accueil"
          className="hidden h-9 w-9 items-center justify-center rounded-lg text-navy/50 transition-colors hover:bg-navy/[0.06] hover:text-navy lg:flex"
        >
          <IconGrid className="h-5 w-5" />
        </Link>
        <Link
          href="/"
          target="_blank"
          rel="noreferrer"
          className="hidden text-sm text-navy/40 transition-colors hover:text-navy md:inline"
        >
          Site vitrine ↗
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal/30 to-teal/10 text-sm font-bold text-teal-ink ring-1 ring-teal/20">
            {initials(fullName)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{fullName}</p>
            <div className="mt-0.5 hidden items-center gap-1.5 sm:flex">
              <span className="badge-teal">{ROLE_LABELS[role]}</span>
              {roleTitle && <span className="truncate text-xs text-navy/40">{roleTitle}</span>}
            </div>
          </div>
        </div>
      </div>
      <SignOutButton />
    </header>
  );
}
