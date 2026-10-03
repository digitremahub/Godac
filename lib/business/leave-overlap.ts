/**
 * Détection de chevauchement de congés (Module 6): two drivers in the
 * same service cannot both be off on overlapping dates without a
 * manager being warned. This does not block the request — it flags
 * it so a manager can decide — since a small agency may sometimes
 * accept it.
 */
export interface LeavePeriod {
  driverId: string;
  startDate: string; // ISO date (YYYY-MM-DD)
  endDate: string; // ISO date (YYYY-MM-DD), inclusive
}

export function findOverlappingLeaves(
  candidate: LeavePeriod,
  sameServiceLeaves: LeavePeriod[],
): LeavePeriod[] {
  const start = new Date(candidate.startDate).getTime();
  const end = new Date(candidate.endDate).getTime();

  return sameServiceLeaves.filter((leave) => {
    if (leave.driverId === candidate.driverId) return false;
    const otherStart = new Date(leave.startDate).getTime();
    const otherEnd = new Date(leave.endDate).getTime();
    return start <= otherEnd && otherStart <= end;
  });
}
