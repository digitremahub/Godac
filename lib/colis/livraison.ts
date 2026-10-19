/**
 * Lieu de dépôt d'un colis livré (mode de remise), et ceux qui exigent
 * une preuve : photo (boîte aux lettres, jardin), QR code scanné sur le
 * téléphone du destinataire / code de retrait (« qr_code »), ou, au point
 * relais (« point_relais »), nom du relais et photo OU code du relais.
 */
export const LIEUX_LIVRAISON = [
  { key: "main_propre", label: "En main propre", photo: false, qr: false, relais: false },
  { key: "qr_code", label: "Avec QR code", photo: false, qr: true, relais: false },
  { key: "boite_aux_lettres", label: "Boîte aux lettres", photo: true, qr: false, relais: false },
  { key: "jardin", label: "Jardin / terrasse", photo: true, qr: false, relais: false },
  { key: "voisin", label: "Chez un voisin", photo: false, qr: false, relais: false },
  { key: "autre", label: "Autre lieu sûr", photo: false, qr: false, relais: false },
  { key: "point_relais", label: "Au point relais", photo: false, qr: false, relais: true },
] as const;

export type LieuLivraison = (typeof LIEUX_LIVRAISON)[number]["key"];

export const photoObligatoire = (lieu: LieuLivraison) => LIEUX_LIVRAISON.some((l) => l.key === lieu && l.photo);
/** Livraison avec QR code : la valeur scannée est la preuve de remise (obligatoire). */
export const qrObligatoire = (lieu: LieuLivraison) => LIEUX_LIVRAISON.some((l) => l.key === lieu && l.qr);
/** Remise au point relais : nom du relais + photo ou code du relais (l'un des deux). */
export const relaisObligatoire = (lieu: LieuLivraison) => LIEUX_LIVRAISON.some((l) => l.key === lieu && l.relais);
export const libelleLieu = (lieu: string | null) => LIEUX_LIVRAISON.find((l) => l.key === lieu)?.label ?? null;

/** Longueur maximale conservée d'un code scanné (contrainte delivery_stops_proof_code_check). */
export const CODE_QR_MAX = 500;

/**
 * Valeur d'un QR code / code de retrait prête à être enregistrée : sans
 * caractères de contrôle ni espaces superflus, tronquée à CODE_QR_MAX.
 * null si rien d'exploitable.
 */
export function normaliserCodeQr(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const propre = brut
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return propre ? propre.slice(0, CODE_QR_MAX) : null;
}

/** Code long abrégé pour l'affichage (« https://exe…/ABC123 »), complet au survol. */
export function resumeCodeQr(code: string, max = 28): string {
  if (code.length <= max) return code;
  const fin = Math.max(6, Math.floor(max / 3));
  return `${code.slice(0, max - fin - 1)}…${code.slice(-fin)}`;
}

/** « 1 retour repris », « 3 retours repris » ; null si aucun. */
export function libelleRetours(n: number | null | undefined): string | null {
  if (!n || n < 1) return null;
  return `${n} retour${n > 1 ? "s" : ""} repris`;
}

/**
 * Preuve de remise lisible : « Avec QR code (ABC123) », « Boîte aux lettres »,
 * « Déposé au relais Tabac de la Gare (code R123) · 2 retours repris »…
 * null si l'arrêt n'est pas livré avec un mode connu.
 */
export function libellePreuve(s: {
  delivered_place: string | null;
  proof_code?: string | null;
  kind?: string | null;
  relay_name?: string | null;
  packages_picked_up?: number | null;
}): string | null {
  const lieu = libelleLieu(s.delivered_place);
  if (!lieu) return null;
  if (s.delivered_place === "point_relais") {
    const base = estPointRelais(s) ? "Déposé au relais" : "Remis au point relais";
    return [
      [base, s.relay_name?.trim() || null].filter(Boolean).join(" ") + (s.proof_code ? ` (code ${resumeCodeQr(s.proof_code)})` : ""),
      estPointRelais(s) ? libelleRetours(s.packages_picked_up) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return s.delivered_place === "qr_code" && s.proof_code ? `${lieu} (${resumeCodeQr(s.proof_code)})` : lieu;
}

/**
 * Contrôle de la preuve de remise, partagé par la feuille de livraison et
 * l'API. Renvoie le message d'erreur, ou null si la remise est complète.
 */
export function refusPreuve(p: { lieu: LieuLivraison; photo: boolean; code: string | null; relais: string | null }): string | null {
  if (photoObligatoire(p.lieu) && !p.photo) return `Photo obligatoire pour une livraison « ${libelleLieu(p.lieu)} ».`;
  if (qrObligatoire(p.lieu) && !p.code) return "Scannez le QR code du destinataire (ou saisissez son code de retrait).";
  if (relaisObligatoire(p.lieu)) {
    if (!p.relais) return "Indiquez le nom ou l'adresse du point relais.";
    if (!p.photo && !p.code) return "Preuve du dépôt au relais : prenez une photo ou scannez le code du relais.";
  }
  return null;
}

// ── Type d'arrêt ────────────────────────────────────────────────────

/**
 * Livraison (par défaut : import, scan, lecture d'étiquette), ramasse
 * (enlèvement chez un expéditeur) ou point relais (dépôt de plusieurs
 * colis chez un commerce partenaire, reprise éventuelle des retours).
 */
export const TYPES_ARRET = [
  { key: "livraison", label: "Livraison" },
  { key: "ramasse", label: "Ramasse" },
  { key: "point_relais", label: "Point relais" },
] as const;

export type TypeArret = (typeof TYPES_ARRET)[number]["key"];

export const estRamasse = (s: { kind?: string | null }) => s.kind === "ramasse";
export const estPointRelais = (s: { kind?: string | null }) => s.kind === "point_relais";
/** Arrêt marqué d'une encoche (ramasse ou point relais). */
export const estMarque = (s: { kind?: string | null }) => estRamasse(s) || estPointRelais(s);

/** Type lu en base (ou absent avant la migration) : tout type inconnu est une livraison. */
export const typeArret = (kind: string | null | undefined): TypeArret => (kind === "ramasse" || kind === "point_relais" ? kind : "livraison");

/** Action de clôture réussie, selon le type : « Livré », « Ramassé », « Déposé au relais ». */
export function libelleFait(s: { kind?: string | null }): string {
  return estRamasse(s) ? "Ramassé" : estPointRelais(s) ? "Déposé au relais" : "Livré";
}

/** Statut d'un arrêt pour l'affichage, selon son type (« Ramassé » plutôt que « Livré »). */
export function libelleStatut(s: { kind?: string | null; status: string }): string {
  if (estPointRelais(s)) {
    if (s.status === "delivered") return "Déposé au relais";
    if (s.status === "failed") return "Dépôt au relais manqué";
    return "Dépôt au relais non fait";
  }
  const ramasse = estRamasse(s);
  if (s.status === "delivered") return ramasse ? "Ramassé" : "Livré";
  if (s.status === "failed") return ramasse ? "Ramasse manquée" : "Échec / absent";
  return ramasse ? "Ramasse non faite" : "Non fait";
}
