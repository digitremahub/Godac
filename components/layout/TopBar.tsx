import Link from "next/link";
import { ROLE_LABELS } from "@/lib/roles/labels";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { IconGrid } from "@/components/layout/icons";
import type { UserRole } from "@/lib/types/domain";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

export function TopBar({ fullName, role, roleTitle }: { fullName: string; role: UserRole; roleTitle?: string | null }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-navy/10 bg-white/70 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          title="Accueil"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-navy/50 transition-colors hover:bg-navy/[0.06] hover:text-navy"
        >
          <IconGrid className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal/30 to-teal/10 text-sm font-bold text-teal-ink ring-1 ring-teal/20">
            {initials(fullName)}
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{fullName}</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="badge-teal">{ROLE_LABELS[role]}</span>
              {roleTitle && <span className="text-xs text-navy/40">{roleTitle}</span>}
            </div>
          </div>
        </div>
      </div>
      <SignOutButton />
    </header>
  );
}
