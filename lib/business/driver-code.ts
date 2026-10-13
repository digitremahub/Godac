/**
 * Code de secours d'un chauffeur (users.driver_code) : "initiales +
 * mois/année de naissance" sur deux chiffres chacun, sans séparateur
 * (ex: FT1188 pour François THËOBALD né en novembre 1988) — bien plus facile à dicter ou taper à la pompe
 * qu'une suite de 6 chiffres aléatoires (l'ancien format, toujours
 * utilisé pour les comptes sans date de naissance renseignée).
 * L'unicité par organisation (voir users_org_driver_code_unique) reste
 * garantie par l'appelant via un suffixe numérique en cas de collision
 * (initiales + mois/année identiques pour deux chauffeurs) — ce module
 * ne fait que calculer le code de base, jamais de requête.
 */

/** Majuscules sans accents : « Élodie » -> « ELODIE ». */
function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("fr-FR");
}

/** Première lettre du prénom + première lettre du nom, majuscules sans accents — "François THËOBALD" -> "FT". */
export function initialsOf(fullName: string): string {
  const parts = sansAccents(fullName).replace(/[^A-Z\s-]/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "XX";
  const first = parts[0]?.[0] ?? "X";
  const last = (parts.length > 1 ? parts[parts.length - 1] : parts[0])?.[0] ?? "X";
  return `${first}${last}`;
}

/** "1988-11-15" -> "1188". */
export function birthMonthYear(birthDateISO: string): string {
  const [year, month] = birthDateISO.split("-");
  return `${month}${(year ?? "").slice(-2)}`;
}

/**
 * Saisie à la pompe → code stocké : majuscules, sans accents, sans
 * espaces ni barre oblique (« ft 11/88 » -> « FT1188 »).
 */
export function normalizeDriverCodeInput(input: string): string {
  return sansAccents(input).replace(/[\s/.]/g, "");
}

/** Code de base, avant tout suffixe de désambiguïsation. */
export function computeDriverCodeBase(fullName: string, birthDateISO: string): string {
  return `${initialsOf(fullName)}${birthMonthYear(birthDateISO)}`;
}
