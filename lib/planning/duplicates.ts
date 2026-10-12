import { parisCalendarDate } from "@/lib/planning/dates";

export interface DuplicateCandidate {
  id: string;
  driver_id: string | null;
  tour_number: string;
  start_at: string;
  status: string;
  created_at: string;
}

/**
 * A planned entry is a duplicate when the same driver already has, on
 * the same Paris day, a tour that was actually started/done (the plan
 * was never matched when they set off), or an earlier planned entry
 * with the same tour number. Only ever flags `planned` rows — a tour
 * that really ran is never a candidate for deletion.
 */
export function plannedDuplicates<T extends DuplicateCandidate>(entries: T[]): { entry: T; duplicateOf: T }[] {
  const byDriverDay = new Map<string, T[]>();
  for (const e of entries) {
    if (!e.driver_id) continue;
    const key = `${e.driver_id}|${parisCalendarDate(e.start_at)}`;
    byDriverDay.set(key, [...(byDriverDay.get(key) ?? []), e]);
  }
  const out: { entry: T; duplicateOf: T }[] = [];
  for (const group of byDriverDay.values()) {
    for (const p of group) {
      if (p.status !== "planned") continue;
      const ran = group.find((o) => o.id !== p.id && (o.status === "in_progress" || o.status === "done"));
      const earlierTwin = group.find((o) => o.id !== p.id && o.status === "planned" && o.tour_number === p.tour_number && o.created_at < p.created_at);
      const duplicateOf = ran ?? earlierTwin;
      if (duplicateOf) out.push({ entry: p, duplicateOf });
    }
  }
  return out.sort((a, b) => a.entry.start_at.localeCompare(b.entry.start_at));
}
