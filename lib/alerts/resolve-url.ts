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
  customer_disputes: "/contestations",
  rental_maintenance_requests: "/loueurs/demandes",
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
  // The requester's own "your question was answered" alert — distinct
  // from the "support_request" broadcast to managers/direction
  // (related_table support_requests → /support above), which that
  // requester can be any role, chauffeur included, and /support is
  // gated to manager-like/direction. The answer lives in the floating
  // assistant widget (every page, every role), not a page of its own —
  // ?assistant=1 tells FloatingChatWidget to open on it.
  support_request_resolved: "/dashboard?assistant=1",
  // A driver asked for papers of this vehicle: open its fiche, where
  // the documents are uploaded / made consultable.
  vehicle_document_request: (relatedId) => (relatedId ? `/vehicles/${relatedId}#papiers` : "/vehicles"),
  // Fin de contrat / forfait km d'un véhicule loué : sa fiche.
  rental_contract: (relatedId) => (relatedId ? `/vehicles/${relatedId}#location` : "/vehicles"),
};

export function resolveAlertUrl(relatedTable: string | null, type?: string | null, relatedId?: string | null): string | null {
  if (type && RESOLVE_URL_BY_TYPE[type]) {
    const entry = RESOLVE_URL_BY_TYPE[type];
    return typeof entry === "function" ? entry(relatedId ?? null) : entry;
  }
  return relatedTable ? (RESOLVE_URL[relatedTable] ?? null) : null;
}
