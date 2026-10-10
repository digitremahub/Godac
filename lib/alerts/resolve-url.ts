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
  tank_deliveries: "/tanks?tab=approvisionnements",
  fines: "/fines",
  planning_entries: "/tours/history",
  support_requests: "/support",
  meeting_requests: "/intranet",
  convocations: "/intranet",
};

// Overrides keyed by alert `type`, checked before the related_table
// fallback above — a validated-planning digest should open the
// planning view itself, not /tours/history (every other
// planning_entries alert — assignment, conflict, swap — is correctly
// served by tour history, so this can't just change the table map).
// A plain string is a fixed destination; a function gets `related_id`
// (messages.sender_id for new_message) to deep-link to the right row —
// no other alert type has needed a per-row link yet.
const RESOLVE_URL_BY_TYPE: Record<string, string | ((relatedId: string | null) => string)> = {
  planning_validated: "/planning/mine",
  new_message: (relatedId) => (relatedId ? `/messenger?with=${relatedId}` : "/messenger"),
};

export function resolveAlertUrl(relatedTable: string | null, type?: string | null, relatedId?: string | null): string | null {
  if (type && RESOLVE_URL_BY_TYPE[type]) {
    const entry = RESOLVE_URL_BY_TYPE[type];
    return typeof entry === "function" ? entry(relatedId ?? null) : entry;
  }
  return relatedTable ? (RESOLVE_URL[relatedTable] ?? null) : null;
}
