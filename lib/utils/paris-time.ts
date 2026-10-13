/**
 * Heure murale de Paris ↔ instants UTC, sans dépendre du fuseau du
 * serveur (UTC sur Vercel). Même principe que minuitParis
 * (lib/ticpe/export.ts) : le décalage est lu via Intl à l'instant
 * voulu, donc +1 h l'hiver, +2 h l'été, changements d'heure compris.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Décalage de Paris par rapport à UTC (minutes) à un instant donné. */
export function parisOffsetMinutes(instant: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((local - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * Date (YYYY-MM-DD) et heure (HH:MM[:SS], minuit si absente) lues à
 * Paris → instant ISO UTC ; null si le format est invalide. Heure
 * inexistante (passage à l'heure d'été, 02:30) → décalée d'une heure ;
 * heure ambiguë (passage à l'heure d'hiver) → seconde occurrence.
 */
export function parisLocalToIso(date: string, time?: string | null): string | null {
  const dm = DAY_RE.exec(date.trim());
  if (!dm) return null;
  let h = 0;
  let mi = 0;
  let s = 0;
  if (time && time.trim()) {
    const tm = TIME_RE.exec(time.trim());
    if (!tm) return null;
    h = Number(tm[1]);
    mi = Number(tm[2]);
    s = tm[3] ? Number(tm[3]) : 0;
    if (h > 23 || mi > 59 || s > 59) return null;
  }
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // Deux passes : le décalage dépend de l'instant qu'on cherche.
  const guess = wall - parisOffsetMinutes(new Date(wall)) * 60000;
  return new Date(wall - parisOffsetMinutes(new Date(guess)) * 60000).toISOString();
}

/** Minuit (heure de Paris) du jour YYYY-MM-DD, en ISO UTC. */
export function parisMidnightIso(day: string): string {
  const iso = parisLocalToIso(day);
  if (!iso) throw new Error(`Jour invalide : ${day}`);
  return iso;
}

/** Jour calendaire (YYYY-MM-DD) à Paris de l'instant donné. */
export function parisDay(instant: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Lendemain d'un jour YYYY-MM-DD. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Bornes [depuis, avant[ couvrant les jours entiers `from`..`to` inclus, heure de Paris. */
export function parisDayRange(from: string, to: string): { since: string; before: string } {
  return { since: parisMidnightIso(from), before: parisMidnightIso(nextDay(to)) };
}

/** Premier jour (YYYY-MM-01) du mois de Paris contenant l'instant, décalé de `monthOffset` mois. */
export function parisMonthStartDay(instant: Date = new Date(), monthOffset = 0): string {
  const [y, m] = parisDay(instant).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + monthOffset, 1)).toISOString().slice(0, 10);
}

/** Minuit de Paris du premier jour du mois (voir parisMonthStartDay), en ISO UTC. */
export function parisMonthStartIso(instant: Date = new Date(), monthOffset = 0): string {
  return parisMidnightIso(parisMonthStartDay(instant, monthOffset));
}
