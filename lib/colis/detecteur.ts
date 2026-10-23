/**
 * Lecteur de codes des étiquettes colis pour le scanner web.
 *
 * Les étiquettes transporteurs portent surtout des codes-barres 1D
 * (Code 128, ITF…) et des Datamatrix, pas des QR codes. Le détecteur
 * natif du navigateur (BarcodeDetector) n'existe pas sur iPhone ni sur
 * Firefox : on charge alors le lecteur ZXing (WebAssembly, servi depuis
 * /zxing, jamais depuis un CDN), qui lit les mêmes formats.
 *
 * Le binaire (1 Mo) est téléchargé une fois puis gardé dans le cache du
 * navigateur (Cache API) : le scanner s'ouvre aussi sans réseau après la
 * première fois. Le chargement est attendu (une erreur n'est plus
 * silencieuse), limité dans le temps, et partagé entre les ouvertures du scanner.
 */
import { choisirFormats, FORMATS_COLIS } from "@/lib/colis/scan";

export { FORMATS_COLIS };

export type Detecteur = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
export type SourceDetecteur = "natif" | "zxing";

/** Chemin du binaire ZXing copié dans public/ (voir lib/colis/__tests__/detecteur.test.ts). */
export const ZXING_WASM_URL = "/zxing/zxing_reader.wasm";

const NOM_CACHE = "godac-zxing-v1";
const DELAI_CHARGEMENT_MS = 20_000;

type DetecteurCtor = {
  new (o: { formats: string[] }): Detecteur;
  getSupportedFormats?: () => Promise<string[]>;
};

/** Détecteur natif s'il lit au moins les codes-barres 1D et Datamatrix, sinon null. */
async function detecteurNatif(): Promise<Detecteur | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: DetecteurCtor }).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = choisirFormats((await BD.getSupportedFormats?.()) ?? []);
    return formats ? new BD({ formats }) : null;
  } catch {
    return null;
  }
}

/** Binaire ZXing : cache du navigateur d'abord (hors ligne), sinon réseau puis mise en cache. */
async function binaireZxing(): Promise<ArrayBuffer> {
  const cache = typeof caches !== "undefined" ? await caches.open(NOM_CACHE).catch(() => null) : null;
  const enCache = await cache?.match(ZXING_WASM_URL).catch(() => undefined);
  if (enCache) return enCache.arrayBuffer();
  const rep = await fetch(ZXING_WASM_URL, { cache: "force-cache" });
  if (!rep.ok) throw new Error(`wasm ${rep.status}`);
  await cache?.put(ZXING_WASM_URL, rep.clone()).catch(() => undefined);
  return rep.arrayBuffer();
}

let zxingEnCours: Promise<Detecteur> | null = null;

async function chargerZxing(): Promise<Detecteur> {
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  const wasmBinary = await binaireZxing();
  // Attendre l'instanciation : sans cela un wasm introuvable ou corrompu
  // échouait plus tard, à chaque image, sans aucun message.
  await prepareZXingModule({
    overrides: { wasmBinary, locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? ZXING_WASM_URL : prefix + path) },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: [...FORMATS_COLIS] }) as unknown as Detecteur;
}

/** Chargement ZXing partagé (une seule fois), avec délai maximal ; un échec permet de réessayer à la prochaine ouverture. */
export function detecteurZxing(): Promise<Detecteur> {
  if (!zxingEnCours) {
    const chargement = chargerZxing();
    const delai = new Promise<never>((_, rejet) => setTimeout(() => rejet(new Error("délai dépassé")), DELAI_CHARGEMENT_MS));
    zxingEnCours = Promise.race([chargement, delai]);
    zxingEnCours.catch(() => {
      zxingEnCours = null;
    });
  }
  return zxingEnCours;
}

/** Lance le téléchargement de ZXing en tâche de fond (si le navigateur n'a pas de détecteur complet) : le scanner s'ouvre ensuite sans attente. */
export function prechargerDetecteur(): void {
  void detecteurNatif().then((n) => {
    if (!n) detecteurZxing().catch(() => undefined);
  });
}

/** Natif si complet, sinon ZXing ; détecteur null si aucun ne se charge (le scanner retombe sur jsQR, QR seulement). */
export async function chargerDetecteur(): Promise<{ detecteur: Detecteur | null; source: SourceDetecteur | null }> {
  const natif = await detecteurNatif();
  if (natif) return { detecteur: natif, source: "natif" };
  try {
    return { detecteur: await detecteurZxing(), source: "zxing" };
  } catch {
    return { detecteur: null, source: null };
  }
}

export async function creerDetecteur(): Promise<Detecteur | null> {
  return (await chargerDetecteur()).detecteur;
}
