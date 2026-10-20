// Connexion Face ID / empreinte : messages d'erreur précis, avec leur
// code, au lieu d'un message générique. Logique pure, testée dans
// lib/auth/__tests__/passkey-erreurs.test.ts.

/** Raisons d'échec côté serveur (journal + réponse JSON `code`). */
export type RaisonPasskey =
  | "sans_compte"
  | "sans_cle"
  | "cle_inconnue"
  | "challenge_absent"
  | "verification_echouee"
  | "lien_impossible"
  | "requete_invalide";

/** Erreur renvoyée par les routes /api/auth/passkey/login/*. */
export class ErreurServeurPasskey extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ErreurServeurPasskey";
    this.code = code;
    this.status = status;
  }
}

export interface ErreurAffichee {
  /** Code court affiché à l'écran (à transmettre au support). */
  code: string;
  message: string;
}

/**
 * Message clair pour une erreur de connexion biométrique : erreurs du
 * navigateur (DOMException, transmises par @simplewebauthn/browser avec
 * leur `name`), erreurs serveur avec leur code et leur texte, autres.
 */
export function expliquerErreurPasskey(e: unknown, contexte: { avecEmail?: boolean; secours?: string } = {}): ErreurAffichee {
  const secours = contexte.secours ?? "le lien de connexion par e-mail";
  if (e instanceof ErreurServeurPasskey) {
    return { code: `${e.code} (${e.status})`, message: e.message };
  }
  const err = (e ?? {}) as { name?: string; message?: string; code?: string };
  const name = err.name ?? "Error";
  switch (name) {
    case "NotAllowedError":
      return {
        code: "NotAllowedError",
        message: `Demande refusée, annulée ou expirée, ou aucune clé utilisable sur cet appareil. Si la fenêtre biométrique ne s'est pas ouverte, la clé a sans doute été enregistrée sur un autre appareil ou navigateur : enregistrez-en une depuis ce téléphone (Mon compte › Face ID / empreinte). Sinon utilisez ${secours}.`,
      };
    case "SecurityError":
      return {
        code: err.code ? `SecurityError/${err.code}` : "SecurityError",
        message: `Ce domaine ne correspond pas à celui de la clé (${typeof window !== "undefined" ? window.location.hostname : "domaine inconnu"}). Ouvrez GODAC depuis son adresse habituelle dans Chrome ou Safari, pas depuis une autre adresse.`,
      };
    case "InvalidStateError":
      return { code: "InvalidStateError", message: "L'appareil refuse cette clé dans son état actuel. Réessayez, ou supprimez puis enregistrez de nouveau la clé dans Mon compte." };
    case "AbortError":
      return { code: "AbortError", message: "Demande interrompue. Réessayez." };
    case "NotSupportedError":
    case "NonPrisEnCharge":
      return {
        code: name,
        message: `Ce navigateur ou cette application ne permet pas Face ID / empreinte. Ouvrez GODAC dans Chrome (Android) ou Safari (iPhone), ou utilisez ${secours}.`,
      };
    case "UnknownError":
      return { code: "UnknownError", message: "Le lecteur biométrique n'a pas pu répondre. Réessayez dans un instant." };
    case "AuthApiError":
    case "AuthError":
      return { code: `session/${err.code ?? name}`, message: `Clé reconnue, mais la session n'a pas pu s'ouvrir : ${err.message ?? "erreur inconnue"}. Réessayez.` };
    case "TypeError":
      return { code: "reseau", message: "Connexion au serveur impossible. Vérifiez le réseau et réessayez." };
    default:
      return { code: err.code ?? name, message: err.message || `Connexion biométrique impossible. Réessayez ou utilisez ${secours}.` };
  }
}

/** Texte d'erreur d'une réponse JSON de route (chaîne, ou objet zod aplati). */
export function texteErreurServeur(json: unknown, statut: number, defaut: string): { message: string; code: string } {
  const j = (json ?? {}) as { error?: unknown; code?: unknown };
  const code = typeof j.code === "string" ? j.code : `http_${statut}`;
  if (typeof j.error === "string" && j.error.trim()) return { message: j.error, code };
  return { message: defaut, code };
}

/**
 * userHandle WebAuthn (base64url des octets UTF-8 de users.id, voir la
 * route d'enregistrement) → users.id. null si absent ou illisible.
 */
export function userIdDepuisHandle(userHandle: string | null | undefined): string | null {
  if (!userHandle) return null;
  try {
    const b64 = userHandle.replace(/-/g, "+").replace(/_/g, "/");
    const texte = Buffer.from(b64 + "===".slice((b64.length + 3) % 4), "base64").toString("utf8");
    return /^[0-9a-f-]{36}$/i.test(texte) ? texte.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Relying party WebAuthn : le domaine de la requête s'il est autorisé
 * (NEXT_PUBLIC_APP_URL, plus WEBAUTHN_EXTRA_ORIGINS séparées par des
 * virgules), sinon celui de NEXT_PUBLIC_APP_URL. Une clé reste liée au
 * domaine où elle a été créée ; on évite seulement de proposer une clé
 * pour un autre domaine que celui de la page (SecurityError).
 */
export function choisirRp(params: { urlApp: string; extra?: string | null; origineRequete?: string | null }): { rpID: string; origin: string; originesAdmises: string[]; rpIdsAdmis: string[] } {
  const base = new URL(params.urlApp);
  const admises = [base.origin];
  for (const brut of (params.extra ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      const u = new URL(brut);
      if (!admises.includes(u.origin)) admises.push(u.origin);
    } catch {
      // Valeur ignorée.
    }
  }
  let choisie = base.origin;
  if (params.origineRequete) {
    try {
      const o = new URL(params.origineRequete).origin;
      if (admises.includes(o)) choisie = o;
    } catch {
      // En-tête Origin illisible : domaine par défaut.
    }
  }
  return {
    rpID: new URL(choisie).hostname,
    origin: choisie,
    originesAdmises: admises,
    rpIdsAdmis: Array.from(new Set(admises.map((o) => new URL(o).hostname))),
  };
}
