import { Card, EmptyState } from "@/components/ui";

export interface WashRecord {
  id: string;
  created_at: string;
  washed_exterior: boolean;
  washed_cabin_interior: boolean;
  washed_trailer: boolean;
  driverName: string;
}

function labels(w: WashRecord): string {
  const parts: string[] = [];
  if (w.washed_exterior) parts.push("Extérieur");
  if (w.washed_cabin_interior) parts.push("Cabine");
  if (w.washed_trailer) parts.push("Semi-remorque");
  return parts.join(" · ");
}

export function WashHistory({ washes }: { washes: WashRecord[] }) {
  if (washes.length === 0) {
    return <EmptyState title="Aucun lavage enregistré" description="Les lavages déclarés depuis la fiche véhicule apparaîtront ici." />;
  }

  return (
    <Card>
      <h3 className="mb-3 text-base">Historique des lavages</h3>
      <ul className="flex flex-col gap-1.5">
        {washes.slice(0, 12).map((w) => (
          <li key={w.id} className="flex items-center justify-between border-t border-navy/5 pt-1.5 text-sm first:border-0 first:pt-0">
            <span className="text-navy/70">{labels(w)}</span>
            <span className="flex items-center gap-3">
              <span className="text-navy/60">{w.driverName}</span>
              <span className="text-xs text-navy/60">{new Date(w.created_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
