/**
 * Pont vers l'application GODAC Livreur des stores (Capacitor, dossier
 * mobile/). Dans un navigateur ordinaire, tout renvoie false / null et
 * le site garde ses solutions web (scanner jsQR, Wake Lock).
 */
type Plugin = Record<string, (...args: any[]) => Promise<any>>;
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, Plugin | undefined>;
}

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return c?.isNativePlatform?.() ? c : null;
}

export const estAppNative = () => capacitor() !== null;

const FORMATS = ["QR_CODE", "DATA_MATRIX", "CODE_128", "CODE_39", "EAN_13", "ITF", "PDF_417", "AZTEC"];

/** Le scanner natif (Google ML Kit) est-il utilisable ? */
export function scannerNatifDisponible(): boolean {
  return Boolean(capacitor()?.Plugins?.BarcodeScanner);
}

/**
 * Ouvre le scanner natif plein écran pour un code. Renvoie le texte lu,
 * ou null si le chauffeur a fermé le scanner.
 */
export async function scannerNatif(): Promise<string | null> {
  const c = capacitor();
  const bs = c?.Plugins?.BarcodeScanner;
  if (!c || !bs) return null;
  if (c.getPlatform?.() === "android") {
    const { available } = await bs.isGoogleBarcodeScannerModuleAvailable!();
    if (!available) {
      await bs.installGoogleBarcodeScannerModule!();
      throw new Error("Installation du scanner Google en cours : réessayez dans quelques secondes.");
    }
  } else {
    const { camera } = await bs.requestPermissions!();
    if (camera !== "granted" && camera !== "limited") throw new Error("Autorisez l'appareil photo pour GODAC Livreur dans les réglages du téléphone.");
  }
  try {
    const { barcodes } = await bs.scan!({ formats: FORMATS });
    return (barcodes as { rawValue?: string }[])[0]?.rawValue ?? null;
  } catch (e) {
    // Fermeture du scanner par le chauffeur : pas une erreur.
    if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}

/** Garde l'écran allumé (app native) ; renvoie la fonction qui le relâche. */
export async function garderEcranAllume(): Promise<(() => void) | null> {
  const ka = capacitor()?.Plugins?.KeepAwake;
  if (!ka) return null;
  await ka.keepAwake!().catch(() => undefined);
  return () => void ka.allowSleep!().catch(() => undefined);
}
