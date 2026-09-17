export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function StatTile({
  label,
  value,
  accent = "teal",
}: {
  label: string;
  value: string;
  accent?: "teal" | "orange" | "gold";
}) {
  const accentClass = {
    teal: "text-teal",
    orange: "text-orange",
    gold: "text-gold",
  }[accent];
  const barClass = {
    teal: "bg-teal",
    orange: "bg-orange",
    gold: "bg-gold",
  }[accent];

  return (
    <Card className="relative flex flex-col gap-1 overflow-hidden pl-6">
      <span className={`absolute left-0 top-0 h-full w-1 ${barClass}`} />
      <span className="text-sm text-white/50">{label}</span>
      <span className={`font-display text-3xl font-extrabold ${accentClass}`}>{value}</span>
    </Card>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-white/15 text-white/25">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </div>
      <p className="font-semibold text-white/80">{title}</p>
      {description && <p className="max-w-md text-sm text-white/50">{description}</p>}
    </Card>
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-white/50">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
