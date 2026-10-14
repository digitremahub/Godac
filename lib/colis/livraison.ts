/**
 * Lieu de dépôt d'un colis livré (mode de remise), et ceux qui exigent
 * une preuve : photo (boîte aux lettres, jardin) ou QR code scanné sur le
 * téléphone du destinataire / code de retrait (« qr_code »).
 */
export const LIEUX_LIVRAISON = [
  { key: "main_propre", label: "En main propre", photo: false, qr: false },
  { key: "qr_code", label: "Avec QR code", photo: false, qr: true },
  { key: "boite_aux_lettres", label: "Boîte aux lettres", photo: true, qr: false },
  { key: "jardin", label: "Jardin / terrasse", photo: true, qr: false },
  { key: "voisin", label: "Chez un voisin", photo: false, qr: false },
  { key: "autre", label: "Autre lieu sûr", photo: false, qr: false },
] as const;

export type LieuLivraison = (typeof LIEUX_LIVRAISON)[number]["key"];

export const photoObligatoire = (lieu: LieuLivraison) => LIEUX_LIVRAISON.some((l) => l.key === lieu && l.photo);
/** Livraison avec QR code : la valeur scannée est la preuve de remise (obligatoire). */
export const qrObligatoire = (lieu: LieuLivraison) => LIEUX_LIVRAISON.some((l) => l.key === lieu && l.qr);
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

/**
 * Preuve de remise lisible : « Avec QR code (ABC123) », « Boîte aux lettres »…
 * null si l'arrêt n'est pas livré avec un mode connu.
 */
export function libellePreuve(s: { delivered_place: string | null; proof_code?: string | null }): string | null {
  const lieu = libelleLieu(s.delivered_place);
  if (!lieu) return null;
  return s.delivered_place === "qr_code" && s.proof_code ? `${lieu} (${resumeCodeQr(s.proof_code)})` : lieu;
}

// ── Type d'arrêt ────────────────────────────────────────────────────

/** Livraison (par défaut : import, scan, lecture d'étiquette) ou ramasse (enlèvement chez un expéditeur). */
export const TYPES_ARRET = [
  { key: "livraison", label: "Livraison" },
  { key: "ramasse", label: "Ramasse" },
] as const;

export type TypeArret = (typeof TYPES_ARRET)[number]["key"];

export const estRamasse = (s: { kind?: string | null }) => s.kind === "ramasse";

/** Type lu en base (ou absent avant la migration) : tout ce qui n'est pas « ramasse » est une livraison. */
export const typeArret = (kind: string | null | undefined): TypeArret => (kind === "ramasse" ? "ramasse" : "livraison");

/** Statut d'un arrêt pour l'affichage, selon son type (« Ramassé » plutôt que « Livré »). */
export function libelleStatut(s: { kind?: string | null; status: string }): string {
  const ramasse = estRamasse(s);
  if (s.status === "delivered") return ramasse ? "Ramassé" : "Livré";
  if (s.status === "failed") return ramasse ? "Ramasse manquée" : "Échec / absent";
  return ramasse ? "Ramasse non faite" : "Non fait";
}
