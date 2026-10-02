/**
 * Server-side fallback when a driver leaves "numéro de tournée" empty
 * at departure — date + registration keeps it unique enough per
 * vehicle/day without asking the driver to invent one.
 */
export function generateTourNumber(registration: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}-${registration.replace(/\s+/g, "")}`;
}
