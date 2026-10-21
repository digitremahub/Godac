/**
 * Mise en forme commune (heure de Paris), sans dépendance serveur :
 * utilisée par les messages de notification, les API et les écrans.
 */

const TZ = "Europe/Paris";

/** « 07:10 » (heure de Paris). */
export function heureParis(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

/** « 12/10/2026 » (date de Paris). Accepte un instant ou une date « AAAA-MM-JJ ». */
export function dateParis(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

/** « 12/10 » (jour et mois, heure de Paris). */
export function jourMoisParis(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
}

/** « 135 € » ou « 67,50 € ». */
export function montantEuros(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).replace(/ | /g, " ")} €`;
}

/** Distance en mètres entre deux points (haversine). */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Plus proche point GPS d'un instant, dans une marge (minutes). */
export function pointLePlusProche<P extends { at: string }>(points: readonly P[], iso: string, margeMinutes: number): P | null {
  const t = Date.parse(iso);
  let best: P | null = null;
  let ecart = margeMinutes * 60_000 + 1;
  for (const p of points) {
    const e = Math.abs(Date.parse(p.at) - t);
    if (e < ecart) {
      ecart = e;
      best = p;
    }
  }
  return best;
}
