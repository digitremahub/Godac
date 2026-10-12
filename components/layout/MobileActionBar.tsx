"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/types/domain";
import { IconClock, IconFlag, IconPlusCircle, IconWrench, IconCalendar } from "@/components/layout/icons";

interface ActionItem {
  href: string;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
  moduleKey?: string;
}

/**
 * Fixed bottom bar for the two field-facing roles, shown only below
 * `lg` where the sidebar itself is hidden behind the drawer — the
 * four things a driver reaches for constantly shouldn't need two taps
 * (open menu, then pick an item) every time.
 */
export function MobileActionBar({
  role,
  enabledModuleKeys,
  hasActiveTour,
}: {
  role: UserRole;
  enabledModuleKeys: string[];
  hasActiveTour: boolean;
}) {
  const pathname = usePathname() ?? "";
  if (role !== "chauffeur" && role !== "manager_chauffeur") return null;

  const enabled = new Set(enabledModuleKeys);
  const items: ActionItem[] = [
    {
      href: hasActiveTour ? "/tours/end" : "/tours/start",
      label: hasActiveTour ? "Retour" : "Tournée",
      icon: hasActiveTour ? IconFlag : IconClock,
      moduleKey: "planning",
    },
    { href: "/fuel?new=1", label: "Plein", icon: IconPlusCircle },
    { href: "/maintenance", label: "Signaler", icon: IconWrench, moduleKey: "maintenance_requests" },
    { href: "/planning/mine", label: "Planning", icon: IconCalendar, moduleKey: "planning" },
  ].filter((item) => !item.moduleKey || enabled.has(item.moduleKey));

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Actions rapides"
      className="fixed inset-x-3 bottom-3 z-30 lg:hidden"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex rounded-2xl bg-navy/95 p-1.5 shadow-pop backdrop-blur-md">
        {items.map((item) => {
          const Icon = item.icon;
          const path = item.href.split("?")[0]!;
          const active = pathname === path || pathname.startsWith(`${path}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors ${
                  active ? "bg-white/10 text-teal" : "text-white/75 active:bg-white/10"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
