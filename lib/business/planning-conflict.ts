/**
 * Driver double-booking detection — a driver's service is an
 * attribute of the tour, not of the driver (see lib/business/
 * planning-conflict.test.ts and the "fiche chauffeur" feature): the
 * same driver can legitimately run tours for several services across
 * a week, even the same day. What's never legitimate is the SAME
 * driver starting two tours at the exact same instant — physically
 * impossible, whatever the services involved. Same "flag, don't
 * block" convention as lib/business/leave-overlap.ts: a manager might
 * have a real reason (a data-entry mistake elsewhere, a deliberate
 * handover), so this surfaces a warning rather than rejecting the
 * write. There's no stored tour duration (a 'planned' entry only has
 * a start time), so exact-instant collision is the only signal that
 * doesn't produce false positives from two merely same-day tours.
 */
export interface DriverTourSlot {
  entryId: string;
  startAt: string;
  status: string;
}

const CONFLICTING_STATUSES = new Set(["planned", "in_progress"]);

export function findDriverTimeConflicts(candidate: DriverTourSlot, sameDriverEntries: DriverTourSlot[]): DriverTourSlot[] {
  return sameDriverEntries.filter(
    (e) => e.entryId !== candidate.entryId && e.startAt === candidate.startAt && CONFLICTING_STATUSES.has(e.status),
  );
}
