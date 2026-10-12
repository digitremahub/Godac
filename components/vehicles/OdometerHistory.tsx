import { Card, EmptyState } from "@/components/ui";

export interface OdometerReading {
  at: string;
  km: number;
  label: string;
}

/**
 * Combined km history for a vehicle — fed by the two places a reading
 * gets taken today: tour start/end (planning_entries.start_km/end_km,
 * OCR-readable since the driver photographs the dashboard, see
 * components/tours/{Start,End}TourFlow) and a maintenance request
 * (vehicle_interventions.odometer_km). Each source stays independent
 * in the database; this is purely a read-side merge for display.
 */
export function OdometerHistory({ readings }: { readings: OdometerReading[] }) {
  if (readings.length === 0) {
    return (
      <EmptyState
        title="Aucun relevé kilométrique"
        description="Les kilométrages saisis aux départs/retours de tournée et aux demandes d'entretien apparaîtront ici."
      />
    );
  }

  const sorted = [...readings].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const latest = sorted[0]!;

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-base">Suivi kilométrique</h3>
        <p className="text-sm text-navy/65">
          Dernier relevé : <span className="font-semibold text-navy">{latest.km.toLocaleString("fr-FR")} km</span>
          {" · "}
          {new Date(latest.at).toLocaleDateString("fr-FR")}
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {sorted.slice(0, 12).map((r, i) => (
          <li key={i} className="flex items-center justify-between border-t border-navy/5 pt-1.5 text-sm first:border-0 first:pt-0">
            <span className="text-navy/70">{r.label}</span>
            <span className="flex items-center gap-3">
              <span className="font-medium">{r.km.toLocaleString("fr-FR")} km</span>
              <span className="text-xs text-navy/60">{new Date(r.at).toLocaleDateString("fr-FR")}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
