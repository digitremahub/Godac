/**
 * Date et heure locales de Paris, sans dépendance : la tournée se planifie
 * à l'heure de Paris quel que soit le fuseau du serveur (UTC sur Vercel)
 * ou du téléphone. Les passages heure d'été / heure d'hiver sont gérés
 * par Intl (jour de la semaine et minutes depuis minuit toujours justes).
 */

const FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const deux = (n: number) => String(n).padStart(2, "0");

function morceaux(instant: Date) {
  const p: Record<string, string> = {};
  for (const x of FORMAT.formatToParts(instant)) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute) };
}

/** « 2026-10-13 » : date du jour à Paris pour cet instant. */
export function dateParis(instant: Date): string {
  const p = morceaux(instant);
  return `${p.y}-${deux(p.m)}-${deux(p.d)}`;
}

/** Minutes écoulées depuis minuit, heure de Paris (0 à 1439). */
export function minutesParis(instant: Date): number {
  const p = morceaux(instant);
  return p.h * 60 + p.min;
}

/** Jour ISO d'une date « AAAA-MM-JJ » : 1 = lundi … 7 = dimanche. */
export function jourIso(ymd: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const [y, m, d] = ymd.split("-").map(Number);
  const j = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return (j === 0 ? 7 : j) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** Décalage de Paris sur UTC (en minutes : 60 l'hiver, 120 l'été) à cet instant. */
function decalage(instant: number): number {
  const p = morceaux(new Date(instant));
  const local = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return Math.round((local - Math.floor(instant / 60000) * 60000) / 60000);
}

/**
 * Instant correspondant à `minutes` après minuit (heure de Paris) le jour
 * `ymd`. Les minutes peuvent dépasser 1440 (tournée qui finit après minuit).
 */
export function instantParis(ymd: string, minutes: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const naif = Date.UTC(y!, m! - 1, d!) + Math.round(minutes * 60000);
  let t = naif - decalage(naif) * 60000;
  t = naif - decalage(t) * 60000;
  return new Date(t);
}
