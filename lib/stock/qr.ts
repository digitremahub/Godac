import QRCode from "qrcode";

/**
 * QR code vectoriel (matrice de modules) pour l'étiquette : le contenu est le code
 * seul. Calculé avec la bibliothèque `qrcode` déjà présente ; aucune image.
 * Niveau de correction M (15 %), zone de silence de 4 modules.
 */
export const ZONE_SILENCE_QR = 4;

export interface MatriceQr {
  /** Côté en modules, zone de silence non comprise. */
  taille: number;
  /** Lignes de modules (true = sombre). */
  lignes: boolean[][];
}

export function matriceQr(texte: string): MatriceQr {
  const qr = QRCode.create(texte, { errorCorrectionLevel: "M" });
  const taille = qr.modules.size;
  const lignes: boolean[][] = [];
  for (let r = 0; r < taille; r++) {
    const ligne: boolean[] = [];
    for (let c = 0; c < taille; c++) ligne.push(Boolean(qr.modules.get(r, c)));
    lignes.push(ligne);
  }
  return { taille, lignes };
}

/** Chemin SVG (une unité par module, zone de silence comprise) : segments horizontaux regroupés. */
export function cheminQr(m: MatriceQr, silence = ZONE_SILENCE_QR): string {
  const parties: string[] = [];
  for (let r = 0; r < m.taille; r++) {
    let c = 0;
    while (c < m.taille) {
      if (m.lignes[r]![c]) {
        let j = c;
        while (j < m.taille && m.lignes[r]![j]) j++;
        parties.push(`M${c + silence} ${r + silence}h${j - c}v1h-${j - c}z`);
        c = j;
      } else c++;
    }
  }
  return parties.join("");
}

/** Côté total en modules avec la zone de silence. */
export const tailleTotaleQr = (m: MatriceQr, silence = ZONE_SILENCE_QR): number => m.taille + 2 * silence;
