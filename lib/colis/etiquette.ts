import { extraireTelephone, normaliserTelephone } from "@/lib/colis/telephone";
import { extrairePoids, lirePoids } from "@/lib/colis/poids";

/**
 * Contenu d'un code scanné sur un colis. Selon le transporteur, le
 * QR / Datamatrix contient soit l'adresse du destinataire (texte ou
 * champs séparés), soit seulement un numéro de suivi. On reconnaît une
 * adresse française à son code postal à 5 chiffres suivi d'une ville ;
 * sinon le contenu est traité comme numéro de colis.
 */
export interface LectureCode {
  code: string | null;
  adresse: string | null;
  destinataire: string | null;
  /** Numéro du destinataire quand l'étiquette le porte. */
  telephone?: string | null;
  /** Poids du colis en kg quand l'étiquette le porte. */
  poids?: number | null;
}

const CP_VILLE = /\b(0[1-9]|[1-8]\d|9[0-8])\d{3}\s+[A-Za-zÀ-ÿ' -]{2,}/;

/** `pays` : pays de l'entreprise, pour reconnaître les numéros nationaux hors de France. */
export function analyserCode(brut: string, pays = "FR"): LectureCode {
  const lu = analyserSansTelephone(brut, pays);
  const telephone = lu.telephone ?? (lu.adresse ? extraireTelephone(brut, pays) : null);
  const poids = lu.poids ?? (lu.adresse ? extrairePoids(brut) : null);
  return { ...lu, ...(telephone ? { telephone } : {}), ...(poids ? { poids } : {}) };
}

function analyserSansTelephone(brut: string, pays: string): LectureCode {
  const texte = brut.replace(/\r/g, "").trim();
  if (!texte) return { code: null, adresse: null, destinataire: null };

  // JSON éventuel ({"address": …, "name": …, "tracking": …}).
  if (texte.startsWith("{")) {
    try {
      const o = JSON.parse(texte) as Record<string, unknown>;
      const pick = (...keys: string[]) => {
        for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase()) && typeof o[k] === "string") return (o[k] as string).trim();
        return null;
      };
      const adresse = pick("address", "adresse") ?? [pick("street", "rue"), [pick("zip", "cp", "postcode", "postal_code"), pick("city", "ville")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      const telephone = normaliserTelephone(pick("phone", "tel", "telephone", "téléphone", "mobile"), pays);
      const brutPoids = Object.entries(o).find(([k]) => ["weight", "poids", "weight_kg", "poids_kg"].includes(k.toLowerCase()))?.[1];
      const poids = lirePoids(brutPoids);
      return {
        code: pick("tracking", "parcel", "colis", "id", "barcode"),
        adresse: adresse || null,
        destinataire: pick("name", "nom", "recipient", "destinataire"),
        ...(telephone ? { telephone } : {}),
        ...(poids ? { poids } : {}),
      };
    } catch {
      /* pas du JSON : on continue */
    }
  }

  // Les lignes de téléphone ne sont ni une adresse ni un numéro de colis.
  const lignes = texte
    .split(/\n|\||;/)
    .map((l) => l.trim())
    .filter((l) => l && !(extraireTelephone(l, pays) && l.replace(/^(t[ée]l[ée]?(phone)?|mobile|portable|gsm)\s*[:.]?\s*/i, "").replace(/[\d\s.+()-]/g, "") === ""))
    // Ni les lignes de poids (« Poids : 2,3 kg »).
    .filter((l) => !/^(poids|weight|pds)?\s*[:.]?\s*\d+(?:[.,]\d+)?\s*(kgs?|g|gr)\.?$/i.test(l));
  const iVille = lignes.findIndex((l) => CP_VILLE.test(l));
  if (iVille >= 0 && /^\D*\d{1,4}\D.*\b\d{5}\b/.test(lignes[iVille]!) && lignes[iVille]!.match(CP_VILLE)!.index! > 3) {
    // Rue et ville sur la même ligne (« 3 avenue Foch, 69006 Lyon »).
    return { code: null, adresse: lignes[iVille]!.replace(/\s+/g, " "), destinataire: iVille > 0 ? lignes[iVille - 1]! : null };
  }
  if (iVille >= 0) {
    // Rue = la ligne précédente qui commence par un numéro ou un type de voie.
    const iRue = [...lignes.slice(0, iVille).keys()].reverse().find((i) => /^\d|\b(rue|avenue|av\.|bd|boulevard|chemin|route|allée|place|impasse|lieu-dit|zone|za|zi)\b/i.test(lignes[i]!));
    const rue = iRue !== undefined ? lignes[iRue] : lignes[iVille - 1];
    const adresse = [rue, lignes[iVille]!.match(CP_VILLE)![0]].filter(Boolean).join(", ");
    const destinataire = iRue !== undefined && iRue > 0 ? lignes[iRue - 1]! : null;
    const code = lignes.find((l) => /^(?=.*\d)[A-Z0-9]{8,}$/i.test(l)) ?? null;
    return { code, adresse, destinataire };
  }

  // Une seule ligne d'adresse séparée par des virgules.
  if (CP_VILLE.test(texte) && texte.length < 200) return { code: null, adresse: texte.replace(/\s+/g, " "), destinataire: null };

  return { code: texte.slice(0, 80), adresse: null, destinataire: null };
}
