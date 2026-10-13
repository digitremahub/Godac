/**
 * Numéro de téléphone du destinataire, pour que le chauffeur puisse
 * l'appeler d'un geste depuis la tournée. On reconnaît les numéros
 * français (06 12 34 56 78, +33 6 12 34 56 78, 0033…) et les numéros
 * internationaux écrits avec leur indicatif (+32 …).
 */
const FR = /(?:\+33|0033)\s*\(?0?\)?\s*[1-9](?:[\s.-]?\d{2}){4}|\b0[1-9](?:[\s.-]?\d{2}){4}\b/;
const INTL = /\+(?!33)[1-9]\d{0,2}(?:[\s.-]?\d){7,12}/;

/** Premier numéro trouvé dans un texte, au format d'affichage (06 12 34 56 78). */
export function extraireTelephone(texte: string | null | undefined): string | null {
  if (!texte) return null;
  const m = texte.match(FR) ?? texte.match(INTL);
  return m ? normaliserTelephone(m[0]) : null;
}

/** Numéro saisi → format d'affichage ; null s'il ne ressemble pas à un numéro. */
export function normaliserTelephone(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const t = brut.trim();
  let chiffres = t.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (chiffres.startsWith("0033")) chiffres = "+33" + chiffres.slice(4);
  if (chiffres.startsWith("+33")) {
    const national = chiffres.slice(3).replace(/^0/, "");
    if (/^[1-9]\d{8}$/.test(national)) chiffres = "0" + national;
  }
  if (/^0[1-9]\d{8}$/.test(chiffres)) return chiffres.replace(/(\d{2})(?=\d)/g, "$1 ");
  if (/^\+[1-9]\d{7,14}$/.test(chiffres)) return chiffres;
  return null;
}

/** Lien d'appel (tel:) — le téléphone propose d'appeler directement. */
export const lienTel = (tel: string) => `tel:${tel.replace(/[^\d+]/g, "")}`;

/** Lien SMS pré-rempli pour prévenir le client de l'arrivée. */
export const lienSms = (tel: string, message: string) => `sms:${tel.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;
