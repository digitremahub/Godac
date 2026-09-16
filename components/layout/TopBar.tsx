import { ROLE_LABELS } from "@/lib/roles/labels";
import { SignOutButton } from "@/components/layout/SignOutButton";
import type { UserRole } from "@/lib/types/domain";

export function TopBar({ fullName, role }: { fullName: string; role: UserRole }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-white/10 bg-navy/95 px-6">
      <div>
        <p className="text-sm text-white/50">Connecté en tant que</p>
        <p className="font-semibold">
          {fullName} <span className="badge-teal ml-2">{ROLE_LABELS[role]}</span>
        </p>
      </div>
      <SignOutButton />
    </header>
  );
}
