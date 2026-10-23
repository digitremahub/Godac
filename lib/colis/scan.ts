/**
 * Logique pure du scanner de colis (testée dans lib/colis/__tests__/scan.test.ts) :
 * formats lus, normalisation et validation des codes, anti-doublon,
 * cadence de détection, contraintes caméra et messages d'erreur en français.
 */

/** Formats utiles pour un colis : QR, Datamatrix, Code 128, Code 39, EAN-13, ITF, PDF417, Aztec. */
export const FORMATS_COLIS = ["qr_code", "data_matrix", "code_128", "code_39", "ean_13", "itf", "pdf417", "aztec"] as const;

/** Formats sans lesquels un détecteur natif est écarté (les étiquettes transporteurs). */
export const FORMATS_INDISPENSABLES = ["code_128", "data_matrix"] as const;

/** Formats à demander au détecteur natif : ceux qu'il lit parmi FORMATS_COLIS ; null s'il lui manque un format indispensable. */
export function choisirFormats(supportes: readonly string[]): string[] | null {
  const formats = FORMATS_COLIS.filter((f) => supportes.includes(f));
  return FORMATS_INDISPENSABLES.every((f) => formats.includes(f)) ? [...formats] : null;
}

/** Durée pendant laquelle un même code n'est pas remonté une seconde fois. */
export const FENETRE_DOUBLON_MS = 2000;

/** Longueur maximale d'un code accepté (un QR peut porter une adresse complète). */
export const LONGUEUR_MAX_CODE = 1000;

/**
 * Texte lu par la caméra → texte exploitable : caractères de contrôle
 * (séparateurs GS/RS des codes GS1, retour chariot final) retirés,
 * espaces superflus supprimés. null si rien d'exploitable.
 */
export function normaliserCodeLu(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  // Conserve les retours à la ligne (QR d'adresse), retire le reste des caractères de contrôle.
  const texte = brut
    .replace(/\r/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .trim();
  if (!texte || texte.length > LONGUEUR_MAX_CODE) return null;
  return texte;
}

export type SaisieCode = { ok: true; code: string } | { ok: false; erreur: string };

/** Numéro de colis tapé à la main : espaces retirés, 4 à 80 caractères (lettres, chiffres, - _ . /). */
export function validerSaisieManuelle(saisie: string): SaisieCode {
  const code = saisie.replace(/[\s ]+/g, "");
  if (!code) return { ok: false, erreur: "Saisissez le numéro du colis." };
  if (code.length < 4) return { ok: false, erreur: "Numéro trop court : vérifiez-le." };
  if (code.length > 80) return { ok: false, erreur: "Numéro trop long : vérifiez-le." };
  if (!/^[A-Za-z0-9\-_./]+$/.test(code)) return { ok: false, erreur: "Numéro invalide : lettres, chiffres, tirets uniquement." };
  return { ok: true, code };
}

/**
 * Anti-doublon : un code vu moins de `fenetreMs` après sa dernière observation
 * est ignoré. L'observation est rafraîchie à chaque image où le code est
 * encore visible : un colis laissé devant la caméra n'est donc remonté
 * qu'une fois, et un nouveau passage 2 s après l'avoir retiré est accepté.
 */
export class AntiDoublon {
  private vus = new Map<string, number>();
  constructor(private readonly fenetreMs = FENETRE_DOUBLON_MS) {}

  /** true si le code doit être traité, false si c'est un doublon. */
  accepter(code: string, maintenant: number): boolean {
    const dernier = this.vus.get(code);
    this.vus.set(code, maintenant);
    if (this.vus.size > 200) {
      for (const [c, t] of this.vus) if (maintenant - t >= this.fenetreMs) this.vus.delete(c);
    }
    return dernier === undefined || maintenant - dernier >= this.fenetreMs;
  }

  /** Oublie un code (ex. refusé par l'appelant : permet de le rescanner tout de suite). */
  oublier(code: string) {
    this.vus.delete(code);
  }

  reinitialiser() {
    this.vus.clear();
  }
}

/** Délai avant la prochaine détection : au moins `min`, et jamais plus de ~70 % du temps CPU pris par la détection précédente. */
export function delaiProchaineDetection(dureeMs: number, natif: boolean): number {
  const min = natif ? 100 : 200;
  return Math.min(600, Math.max(min, Math.round(dureeMs * 0.6)));
}

/** Contraintes caméra : caméra arrière, 1280×720 idéal (codes-barres fins), mise au point continue demandée si possible. */
export function contraintesCamera(): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920, min: 640 },
      height: { ideal: 1080, min: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}

/** Message en français pour une erreur getUserMedia / lecture vidéo. */
export function messageErreurCamera(e: unknown, contexteSecurise = true): string {
  if (!contexteSecurise) return "La caméra exige une connexion sécurisée (https) : ouvrez GODAC à l'adresse https. Vous pouvez saisir le numéro à la main.";
  const nom = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  switch (nom) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Accès à la caméra refusé. Autorisez la caméra pour GODAC dans les réglages du navigateur (cadenas de la barre d'adresse), puis rouvrez le scanner. Vous pouvez saisir le numéro à la main.";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "Aucune caméra trouvée sur cet appareil. Saisissez le numéro du colis à la main.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "La caméra est utilisée par une autre application. Fermez-la puis rouvrez le scanner, ou saisissez le numéro à la main.";
    default:
      return "Caméra indisponible. Rouvrez le scanner ou saisissez le numéro du colis à la main.";
  }
}
