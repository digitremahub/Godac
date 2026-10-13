/**
 * Valeurs d'un `<input type="datetime-local">` — toujours l'heure
 * murale du navigateur (Europe/Paris pour nos utilisateurs), jamais
 * l'UTC : `new Date().toISOString().slice(0, 16)` affichait l'heure
 * avec 1 à 2 h de retard. À n'utiliser que côté navigateur ; côté
 * serveur, voir lib/utils/paris-time.ts.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → "YYYY-MM-DDTHH:MM" en heure locale. */
export function toDatetimeLocalValue(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Instant ISO (UTC, tel que stocké) → valeur d'input locale ; "" si absent ou invalide. */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : toDatetimeLocalValue(d);
}

/** Valeur d'input locale → instant ISO UTC ; null si vide ou invalide. */
export function datetimeLocalToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
