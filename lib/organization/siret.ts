/**
 * Identifiants d'entreprise français : SIREN (9 chiffres, l'entreprise)
 * et SIRET (14 chiffres, l'établissement = SIREN + NIC). Les deux
 * portent une clé de Luhn ; seule exception connue, les établissements
 * de La Poste (SIREN 356 000 000), trop nombreux pour la clé : leur
 * SIRET est aussi valide quand la somme de ses chiffres est multiple de 5.
 */

const SIREN_LA_POSTE = "356000000";

/** Garde les chiffres seulement (« 804 467 967 00027 » → « 80446796700027 »). */
export function chiffresSeuls(value: string): string {
  return value.replace(/\D/g, "");
}

export function luhnValide(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let somme = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

export function sirenValide(value: string): boolean {
  const d = chiffresSeuls(value);
  return d.length === 9 && luhnValide(d);
}

export function siretValide(value: string): boolean {
  const d = chiffresSeuls(value);
  if (d.length !== 14) return false;
  if (d.startsWith(SIREN_LA_POSTE)) {
    return luhnValide(d) || [...d].reduce((s, c) => s + Number(c), 0) % 5 === 0;
  }
  return luhnValide(d) && luhnValide(d.slice(0, 9));
}

export type IdentifiantEntreprise =
  | { type: "siret"; valeur: string; siren: string }
  | { type: "siren"; valeur: string; siren: string }
  | { type: "invalide"; raison: string };

/** Analyse une saisie libre : SIRET (14 chiffres) ou SIREN (9), espaces et points tolérés. */
export function analyserIdentifiant(saisie: string): IdentifiantEntreprise {
  const d = chiffresSeuls(saisie);
  if (d.length === 14) {
    return siretValide(d)
      ? { type: "siret", valeur: d, siren: d.slice(0, 9) }
      : { type: "invalide", raison: "Ce SIRET n'est pas valide (clé de contrôle incorrecte) — vérifiez les 14 chiffres." };
  }
  if (d.length === 9) {
    return sirenValide(d)
      ? { type: "siren", valeur: d, siren: d }
      : { type: "invalide", raison: "Ce SIREN n'est pas valide (clé de contrôle incorrecte) — vérifiez les 9 chiffres." };
  }
  return { type: "invalide", raison: "Saisissez un SIRET (14 chiffres) ou un SIREN (9 chiffres)." };
}

/** « 80446796700027 » → « 804 467 967 00027 » ; « 804467967 » → « 804 467 967 ». */
export function formaterSiret(value: string): string {
  const d = chiffresSeuls(value);
  if (d.length === 14) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  if (d.length === 9) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return value;
}
