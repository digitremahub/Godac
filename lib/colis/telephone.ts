import { paysDe } from "@/lib/pays/pays";

/**
 * Numéro de téléphone du destinataire, pour que le chauffeur puisse
 * l'appeler d'un geste depuis la tournée. On reconnaît les numéros
 * français (06 12 34 56 78, +33 6 12 34 56 78, 0033…), les numéros
 * internationaux écrits avec leur indicatif (+32 …, 0032 …) et, pour une
 * entreprise hors de France (`pays`), les numéros nationaux de ce pays,
 * convertis au format international (+32470123456).
 */
const FR = /(?:\+33|0033)\s*\(?0?\)?\s*[1-9](?:[\s.-]?\d{2}){4}|\b0[1-9](?:[\s.-]?\d{2}){4}\b/;
const INTL = /(?:\+|\b00)(?!33)[1-9]\d{0,2}(?:[\s.-]?\(?\d\)?){7,12}(?!\d)/;
/** Numéro national hors de France : au moins 8 chiffres, séparés ou non. */
const NATIONAL = /(?<![\d+])\d(?:[\s./-]?\d){7,11}(?!\d)/;

/** Pays sans préfixe national « 0 » à retirer : le numéro entier suit l'indicatif. */
const SANS_PREFIXE_0 = new Set(["ES", "PT", "IT", "LU"]);

/** Premier numéro trouvé dans un texte, au format d'affichage (06 12 34 56 78). */
export function extraireTelephone(texte: string | null | undefined, pays = "FR"): string | null {
  if (!texte) return null;
  if (pays !== "FR") {
    for (const re of [INTL, NATIONAL, FR]) {
      const m = texte.match(re);
      const tel = m ? normaliserTelephone(m[0], pays) : null;
      if (tel) return tel;
    }
    return null;
  }
  const m = texte.match(FR) ?? texte.match(INTL);
  return m ? normaliserTelephone(m[0]) : null;
}

/**
 * Numéro saisi ou lu → format d'affichage ; null s'il ne ressemble pas à
 * un numéro. France (par défaut) : format national « 06 12 34 56 78 ».
 * Autre pays : numéro national converti avec l'indicatif du pays.
 */
export function normaliserTelephone(brut: string | null | undefined, pays = "FR"): string | null {
  if (!brut) return null;
  let chiffres = brut.trim().replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (/^00[1-9]/.test(chiffres)) chiffres = "+" + chiffres.slice(2);
  const france = pays === "FR";
  if (chiffres.startsWith("+33") && france) {
    const national = chiffres.slice(3).replace(/^0/, "");
    if (/^[1-9]\d{8}$/.test(national)) chiffres = "0" + national;
  }
  if (france) {
    if (/^0[1-9]\d{8}$/.test(chiffres)) return chiffres.replace(/(\d{2})(?=\d)/g, "$1 ");
  } else if (!chiffres.startsWith("+")) {
    const indicatif = paysDe(pays).indicatif;
    if (SANS_PREFIXE_0.has(pays)) {
      if (/^\d{6,12}$/.test(chiffres)) chiffres = indicatif + chiffres;
    } else if (/^0[1-9]\d{5,11}$/.test(chiffres)) {
      chiffres = indicatif + chiffres.slice(1);
    }
  }
  // « +32 (0)470… » : le 0 national entre parenthèses n'est pas composé.
  if (!france) {
    const m = chiffres.match(/^\+(\d{1,3})0(\d+)$/);
    if (m && `+${m[1]}` === paysDe(pays).indicatif && !SANS_PREFIXE_0.has(pays)) chiffres = `+${m[1]}${m[2]}`;
  }
  if (/^\+[1-9]\d{7,14}$/.test(chiffres)) return chiffres;
  return null;
}

/** Lien d'appel (tel:) — le téléphone propose d'appeler directement. */
export const lienTel = (tel: string) => `tel:${tel.replace(/[^\d+]/g, "")}`;

/** Lien SMS pré-rempli pour prévenir le client de l'arrivée. */
export const lienSms = (tel: string, message: string) => `sms:${tel.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;

/** Alerte affichée quand un colis n'a pas de numéro de téléphone. */
export const ALERTE_SANS_TELEPHONE = "Aucun numéro de téléphone : le client ne pourra pas être appelé.";

/** Arrêts encore à faire sans numéro de téléphone (le chauffeur ne pourra pas appeler le client). */
export function arretsSansTelephone<T extends { phone: string | null; status: string }>(stops: T[]): T[] {
  return stops.filter((s) => s.status === "pending" && !s.phone);
}
