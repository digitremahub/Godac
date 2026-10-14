/**
 * Lecteur de codes des étiquettes colis pour le scanner web.
 *
 * Les étiquettes transporteurs portent surtout des codes-barres 1D
 * (Code 128, ITF…) et des Datamatrix, pas des QR codes. Le détecteur
 * natif du navigateur (BarcodeDetector) n'existe pas sur iPhone ni sur
 * Firefox : on charge alors le lecteur ZXing (WebAssembly, servi depuis
 * /zxing, jamais depuis un CDN), qui lit les mêmes formats.
 */

export type Detecteur = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export const FORMATS_COLIS = ["qr_code", "data_matrix", "code_128", "code_39", "ean_13", "itf", "pdf417", "aztec"] as const;

/** Chemin du binaire ZXing copié dans public/ (voir lib/colis/__tests__/detecteur.test.ts). */
export const ZXING_WASM_URL = "/zxing/zxing_reader.wasm";

type DetecteurCtor = {
  new (o: { formats: string[] }): Detecteur;
  getSupportedFormats?: () => Promise<string[]>;
};

/** Détecteur natif s'il lit au moins les codes-barres 1D et Datamatrix, sinon null. */
async function detecteurNatif(): Promise<Detecteur | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: DetecteurCtor }).BarcodeDetector;
  if (!BD) return null;
  try {
    const supportes = (await BD.getSupportedFormats?.()) ?? [];
    const formats = FORMATS_COLIS.filter((f) => supportes.includes(f));
    if (!formats.includes("code_128") || !formats.includes("data_matrix")) return null;
    return new BD({ formats });
  } catch {
    return null;
  }
}

async function detecteurZxing(): Promise<Detecteur> {
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? ZXING_WASM_URL : prefix + path),
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: [...FORMATS_COLIS] });
}

/** Natif si complet, sinon ZXing ; null si aucun ne se charge (le scanner retombe sur jsQR, QR seulement). */
export async function creerDetecteur(): Promise<Detecteur | null> {
  const natif = await detecteurNatif();
  if (natif) return natif;
  try {
    return await detecteurZxing();
  } catch {
    return null;
  }
}
