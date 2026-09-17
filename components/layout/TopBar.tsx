import { ROLE_LABELS } from "@/lib/roles/labels";
import { SignOutButton } from "@/components/layout/SignOutButton";
import type { UserRole } from "@/lib/types/domain";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

export function TopBar({ fullName, role }: { fullName: string; role: UserRole }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-white/10 bg-navy/70 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal/30 to-teal/10 text-sm font-bold text-teal ring-1 ring-teal/20">
          {initials(fullName)}
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">{fullName}</p>
          <span className="badge-teal mt-0.5">{ROLE_LABELS[role]}</span>
        </div>
      </div>
      <SignOutButton />
    </header>
  );
}
