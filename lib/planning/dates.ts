/**
 * Pure date helpers shared between the planning page (server) and its
 * view components (client) — no "server-only" tag, unlike most of
 * lib/, precisely so the client-side "Aujourd'hui" button and view
 * switcher can compute the same Monday-of-week / day-iso logic
 * without a round trip.
 *
 * Everything here works in UTC calendar terms exclusively (Date.UTC,
 * getUTCDay/setUTCDate and friends), never local Date methods. Mixing local-time
 * construction (new Date(y, m, d), .getDay(), .setDate()) with
 * .toISOString() (always UTC) used to make every result depend on
 * the timezone of whatever process ran it: a Vercel server (UTC) and
 * a French user's browser (UTC+1/+2) disagreed on which calendar day
 * a given instant fell on, so the planning grid's whole row of day
 * columns came out one day early for any browser ahead of UTC — which
 * is effectively every real user. Planning's own timestamps are
 * stored as UTC instants, so comparing them against UTC calendar
 * dates here is also what keeps a column's entries matching its
 * label. The one remaining edge case this doesn't cover: "today" can
 * still read as yesterday for a couple of hours right after midnight
 * local time (France is ahead of UTC) — a much narrower, cosmetic gap
 * than the all-day, everyone-affected bug this replaces.
 */
export function mondayOf(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> {year, month, day}, assuming the caller already validated the format. */
function parseISODate(iso: string): { year: number; month: number; day: number } {
  const parts = iso.split("-");
  return { year: Number(parts[0] ?? 0), month: Number(parts[1] ?? 1), day: Number(parts[2] ?? 1) };
}

export function addDays(iso: string, n: number): string {
  const { year, month, day } = parseISODate(iso);
  return toISODate(new Date(Date.UTC(year, month - 1, day + n)));
}

export function todayISO(): string {
  return toISODate(new Date());
}

/**
 * "YYYY-MM-DD" + "HH:MM", understood as the wall-clock time a French
 * user typed into a form (Europe/Paris), converted to the matching
 * UTC instant. Needed anywhere a day+time pair is turned into a
 * start_at timestamp on the server instead of in the browser: Vercel's
 * runtime timezone is UTC, so `new Date(`${day}T${time}:00`)` there
 * silently treats the typed time as UTC and stores e.g. "08:00" as
 * 08:00 UTC — 09:00 or 10:00 Paris depending on DST — instead of the
 * intended 08:00 Paris. Same bug class as the calendar-day/UTC
 * mismatch documented at the top of this file, but for time-of-day.
 * Browser-side code doesn't need this: `new Date(...).toISOString()`
 * there already resolves against the user's own (Paris) timezone.
 */
export function parisWallTimeToUtcISOString(day: string, time: string): string {
  const { year, month, day: dayNum } = parseISODate(day);
  const [hour, minute] = time.split(":").map(Number);
  const guessUTC = Date.UTC(year, month - 1, dayNum, hour, minute, 0);

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(guessUTC))
      .map((p) => [p.type, p.value]),
  );
  const asIfUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guessUTC + (guessUTC - asIfUTC)).toISOString();
}

/** "YYYY-MM" -> {year, month} (1-indexed), assuming the caller already validated the format. */
function parseMonth(monthStr: string): { year: number; month: number } {
  const parts = monthStr.split("-");
  return { year: Number(parts[0] ?? 0), month: Number(parts[1] ?? 1) };
}

/** "YYYY-MM" -> first day of that month, ISO date. */
export function firstOfMonth(monthStr: string): string {
  const { year, month } = parseMonth(monthStr);
  return toISODate(new Date(Date.UTC(year, month - 1, 1)));
}

export function addMonths(monthStr: string, n: number): string {
  const { year, month } = parseMonth(monthStr);
  const d = new Date(Date.UTC(year, month - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Every ISO date in the month, Monday-aligned (leading/trailing days from adjacent months included for a full calendar grid). */
export function monthCalendarDays(monthStr: string): string[] {
  const start = firstOfMonth(monthStr);
  const { year, month } = parseMonth(monthStr);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const gridStart = toISODate(mondayOf(new Date(`${start}T00:00:00Z`)));
  const lastDay = addDays(start, daysInMonth - 1);
  const lastDow = new Date(`${lastDay}T00:00:00Z`).getUTCDay();
  const trailing = lastDow === 0 ? 0 : 7 - lastDow;
  const gridEnd = addDays(lastDay, trailing);
  const days: string[] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}
