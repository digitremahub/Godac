/**
 * Maps an alert's related_table to the page where that problem
 * actually gets reviewed/corrected — shared between the in-app alert
 * center (components/alerts/AlertList.tsx, a "Voir →" link) and the
 * push notification payload (app/api/webhooks/supabase-alerts),
 * which opens the same page when the notification is tapped. No
 * per-row deep link yet (none of these pages accept one today).
 */
const RESOLVE_URL: Record<string, string> = {
  fuel_entries: "/fuel",
  vehicle_interventions: "/maintenance",
  tank_deliveries: "/tanks/deliveries",
  fines: "/fines",
  planning_entries: "/tours/history",
  support_requests: "/support",
  meeting_requests: "/intranet",
  convocations: "/intranet",
};

export function resolveAlertUrl(relatedTable: string | null): string | null {
  return relatedTable ? (RESOLVE_URL[relatedTable] ?? null) : null;
}
