import Link from "next/link";
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
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-navy/10 bg-white/95 backdrop-blur-sm lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-navy/60 transition-colors active:bg-navy/[0.05]"
          >
            <Icon className="h-5 w-5" />
            <span className="text-[11px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
