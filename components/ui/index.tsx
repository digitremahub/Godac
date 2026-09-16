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

  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm text-white/50">{label}</span>
      <span className={`font-display text-3xl font-extrabold ${accentClass}`}>{value}</span>
    </Card>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-12 text-center">
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
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-white/50">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
