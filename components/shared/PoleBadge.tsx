import {
  IconBuilding,
  IconChartBar,
  IconCoins,
  IconFileText,
  IconMessage,
  IconShieldCheck,
  IconTruck,
  IconUsers,
  IconWrench,
} from "@/components/layout/icons";
import { poleDe, type PoleIcon as PoleIconName } from "@/lib/organization/poles";

const ICONS: Record<PoleIconName, (props: { className?: string }) => React.ReactElement> = {
  Truck: IconTruck,
  Building: IconBuilding,
  FileText: IconFileText,
  Message: IconMessage,
  Coins: IconCoins,
  Users: IconUsers,
  Wrench: IconWrench,
  ChartBar: IconChartBar,
  ShieldCheck: IconShieldCheck,
};

/** Icône d'un pôle (lib/organization/poles.ts). */
export function PoleIcon({ pole, className }: { pole: string | null | undefined; className?: string }) {
  const Icon = ICONS[poleDe(pole).icon];
  return <Icon className={className} />;
}

/** Pastille « ● Pôle » compacte, pour les listes de personnes. */
export function PoleBadge({ pole }: { pole: string | null | undefined }) {
  const p = poleDe(pole);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-navy/70">
      <span className={`h-2 w-2 shrink-0 rounded-full ${p.dotClass}`} aria-hidden="true" />
      {p.label}
    </span>
  );
}
