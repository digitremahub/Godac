import { Card } from "@/components/ui";

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h${m.toString().padStart(2, "0")}`;
}

function formatEuros(value: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * Le chauffeur voit son propre salaire estimé du mois en cours — à la
 * différence de /payroll (direction uniquement, tous les chauffeurs),
 * ici c'est uniquement sa propre donnée, calculée depuis son propre
 * contrat (lib/business/payroll.ts). Grossit au fil des tournées
 * terminées dans le mois ; les jours d'absence approuvés comptent
 * aussi, à titre d'estimation (pas un vrai calcul d'indemnités).
 */
export function MonthlyEarningsCard({
  workedHours,
  absenceWeekdays,
  estimate,
  hasContract,
}: {
  workedHours: number;
  absenceWeekdays: number;
  estimate: { gross: number | null; net: number | null } | null;
  hasContract: boolean;
}) {
  if (!hasContract) {
    return (
      <Card className="mb-4 text-sm text-navy/65">
        💰 Votre salaire estimé ce mois-ci s&apos;affichera ici une fois votre contrat renseigné par la direction.
      </Card>
    );
  }

  return (
    <Card className="mb-4 flex flex-col gap-1">
      <p className="text-sm text-navy/65">💰 Votre salaire estimé ce mois-ci</p>
      <p className="text-sm">
        {formatHours(workedHours)} travaillées
        {absenceWeekdays > 0 ? ` + ${absenceWeekdays} jour(s) d'absence rémunéré(s)` : ""}
      </p>
      {estimate && (estimate.gross !== null || estimate.net !== null) ? (
        <p className="text-xl">
          {estimate.gross !== null ? formatEuros(estimate.gross) : "—"} brut
          {estimate.net !== null ? ` · ${formatEuros(estimate.net)} net` : ""}
        </p>
      ) : (
        <p className="text-sm text-navy/60">Taux horaire non renseigné.</p>
      )}
      <p className="text-xs text-navy/60">Estimation indicative — ne remplace pas votre bulletin de paie.</p>
    </Card>
  );
}
