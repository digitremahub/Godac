/**
 * Pure date helpers shared between the planning page (server) and its
 * view components (client) — no "server-only" tag, unlike most of
 * lib/, precisely so the client-side "Aujourd'hui" button and view
 * switcher can compute the same Monday-of-week / day-iso logic
 * without a round trip.
 */
export function mondayOf(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** "YYYY-MM" -> {year, month} (1-indexed), assuming the caller already validated the format. */
function parseMonth(monthStr: string): { year: number; month: number } {
  const parts = monthStr.split("-");
  return { year: Number(parts[0] ?? 0), month: Number(parts[1] ?? 1) };
}

/** "YYYY-MM" -> first day of that month, ISO date. */
export function firstOfMonth(monthStr: string): string {
  const { year, month } = parseMonth(monthStr);
  return toISODate(new Date(year, month - 1, 1));
}

export function addMonths(monthStr: string, n: number): string {
  const { year, month } = parseMonth(monthStr);
  const d = new Date(year, month - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Every ISO date in the month, Monday-aligned (leading/trailing days from adjacent months included for a full calendar grid). */
export function monthCalendarDays(monthStr: string): string[] {
  const start = firstOfMonth(monthStr);
  const { year, month } = parseMonth(monthStr);
  const daysInMonth = new Date(year, month, 0).getDate();
  const gridStart = toISODate(mondayOf(new Date(`${start}T00:00:00`)));
  const lastDay = addDays(start, daysInMonth - 1);
  const lastDow = new Date(`${lastDay}T00:00:00`).getDay();
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
