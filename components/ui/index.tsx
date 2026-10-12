export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

const ACCENTS = {
  teal: { dot: "bg-teal", chip: "bg-teal/[0.12] text-teal-ink" },
  orange: { dot: "bg-orange", chip: "bg-orange/[0.12] text-orange-ink" },
  gold: { dot: "bg-gold", chip: "bg-gold/[0.2] text-gold-ink" },
} as const;

/**
 * KPI tile: label on top, the figure in navy (readable at a glance,
 * whatever the accent), the accent kept to a small marker so a row
 * of six tiles doesn't turn into a rainbow.
 */
export function StatTile({
  label,
  value,
  accent = "teal",
}: {
  label: string;
  value: string;
  accent?: "teal" | "orange" | "gold";
}) {
  const a = ACCENTS[accent];
  return (
    <Card className="group relative flex h-full flex-col justify-between gap-3 !p-4 transition-[border-color,box-shadow] sm:!p-5 [a:hover>&]:border-navy/15 [a:hover>&]:shadow-raised">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium leading-snug text-navy/65">{label}</span>
        <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${a.dot}`} />
      </div>
      <span className="text-[26px] font-bold leading-none tracking-tight tabular-nums text-navy sm:text-[30px]">
        {value}
      </span>
    </Card>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-navy/15 bg-white/60 px-6 py-14 text-center">
      <div aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy/[0.05] text-navy/40">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h4l2 3h6l2-3h4M5 13 7 5h10l2 8v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-5Z" />
        </svg>
      </div>
      <p className="font-semibold text-navy">{title}</p>
      {description && <p className="max-w-md text-pretty text-sm text-navy/65">{description}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-pretty text-sm text-navy/65 sm:text-[15px]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
