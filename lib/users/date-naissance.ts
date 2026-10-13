/** Date de naissance plausible pour un salarié (16 à 80 ans), format AAAA-MM-JJ. */
export function dateNaissanceValide(iso: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return false;
  const age = (now.getTime() - d.getTime()) / (365.25 * 86_400_000);
  return age >= 16 && age <= 80;
}
