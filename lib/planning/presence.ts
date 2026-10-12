import { parisCalendarDate } from "@/lib/planning/dates";

export interface PresenceTour {
  start_at: string;
  end_at: string | null;
  status: string;
}

export interface PresenceDay {
  /** A tour was actually started (not merely planned) that day. */
  morning: boolean;
  /** A tour was closed (return recorded) that day. */
  evening: boolean;
}

/**
 * A driver's month of presence, read from their own tours: "morning"
 * on the Paris calendar day a tour was really started, "evening" on
 * the day its return was recorded. A planned-but-never-started entry
 * counts for nothing — the calendar shows what happened, not what was
 * scheduled. Days are Europe/Paris, like everything a driver reads.
 */
export function presenceByDay(tours: PresenceTour[], monthStr: string): {
  days: Map<string, PresenceDay>;
  mornings: number;
  evenings: number;
} {
  const days = new Map<string, PresenceDay>();
  const touch = (day: string) => {
    let d = days.get(day);
    if (!d) {
      d = { morning: false, evening: false };
      days.set(day, d);
    }
    return d;
  };

  for (const t of tours) {
    if (t.status !== "in_progress" && t.status !== "done") continue;
    const startDay = parisCalendarDate(t.start_at);
    if (startDay.startsWith(monthStr)) touch(startDay).morning = true;
    if (t.status === "done" && t.end_at) {
      const endDay = parisCalendarDate(t.end_at);
      if (endDay.startsWith(monthStr)) touch(endDay).evening = true;
    }
  }

  let mornings = 0;
  let evenings = 0;
  for (const d of days.values()) {
    if (d.morning) mornings++;
    if (d.evening) evenings++;
  }
  return { days, mornings, evenings };
}
