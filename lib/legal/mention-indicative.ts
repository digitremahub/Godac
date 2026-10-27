/**
 * Mention « document indicatif » : GODAC est un outil d'organisation et de
 * gain de temps ; l'entreprise (avec son expert-comptable ou son responsable
 * paie) reste responsable de vérifier les paramétrages et les résultats
 * (paie, TICPE, carburant, congés, heures supplémentaires) avant tout usage
 * déclaratif. Texte unique, repris dans les écrans, les PDF et les exports,
 * et à l'article « Outil d'organisation » des CGV / CGU.
 */
export const MENTION_INDICATIVE =
  "Document établi à titre indicatif par GODAC à partir des paramètres de l'entreprise. À faire vérifier par votre expert-comptable / responsable paie avant tout usage déclaratif.";

/** Version du texte accepté : changer la valeur redemande l'accusé de lecture aux directions. */
export const VERSION_MENTION_INDICATIVE = "1";

/** Action du journal d'audit (lib/audit/journal.ts) qui trace l'accusé de lecture, une fois par organisation. */
export const ACTION_ACCUSE_INDICATIF = "accuse_parametres_indicatifs";
