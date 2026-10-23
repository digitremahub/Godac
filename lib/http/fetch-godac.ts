// Client HTTP des écrans de l'espace connecté. Lit le corps homogène des
// refus produits par lib/acces/garde-api.ts ({ error, code, module,
// rolesAutorises, utilise, inclus }) pour afficher le bon état (module à
// activer, rôle, limite de formule, quota) au lieu d'un alert(json.error).
// Fichier pur : importable côté client et testé sans navigateur.

export type CodeRefus = "NON_CONNECTE" | "ROLE_REFUSE" | "MODULE_INACTIF" | "LIMITE_FORMULE" | "QUOTA_ATTEINT" | "ERREUR";

export interface Refus {
  code: CodeRefus;
  message: string;
  statut: number;
  module?: string;
  modules?: string[];
  rolesAutorises?: string[];
  utilise?: number;
  inclus?: number;
  /** Génération refusée : nombre de points bloquants à régler (ou à confirmer). */
  bloquants?: number;
}

export type ReponseGodac<T> = { ok: true; data: T; statut: number } | { ok: false; refus: Refus };

const CODES: readonly CodeRefus[] = ["NON_CONNECTE", "ROLE_REFUSE", "MODULE_INACTIF", "LIMITE_FORMULE", "QUOTA_ATTEINT"];

/** Code déduit du statut quand l'API n'en donne pas (routes non migrées). */
function codeParStatut(statut: number): CodeRefus {
  if (statut === 401) return "NON_CONNECTE";
  if (statut === 402) return "LIMITE_FORMULE";
  if (statut === 429) return "QUOTA_ATTEINT";
  return "ERREUR";
}

/** Corps JSON d'une réponse en erreur → refus typé. */
export function lireRefus(statut: number, corps: unknown): Refus {
  const c = (corps && typeof corps === "object" ? corps : {}) as Record<string, unknown>;
  const brut = c.error;
  const message =
    typeof brut === "string"
      ? brut
      : brut && typeof brut === "object" && typeof (brut as { message?: unknown }).message === "string"
        ? (brut as { message: string }).message
        : statut >= 500
          ? "Le serveur n'a pas pu traiter la demande. Réessayez dans un instant."
          : "La demande a été refusée.";
  const code = CODES.includes(c.code as CodeRefus) ? (c.code as CodeRefus) : codeParStatut(statut);
  const nombre = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    code,
    message,
    statut,
    module: typeof c.module === "string" ? c.module : undefined,
    modules: Array.isArray(c.modules) ? (c.modules as string[]) : undefined,
    rolesAutorises: Array.isArray(c.rolesAutorises) ? (c.rolesAutorises as string[]) : undefined,
    utilise: nombre(c.utilise),
    inclus: nombre(c.inclus),
    bloquants: nombre(c.bloquants),
  };
}

/**
 * fetch() + lecture du refus. Ne lève jamais : une panne réseau devient
 * un refus « ERREUR » avec un message lisible.
 */
export async function fetchGodac<T = unknown>(url: string, init?: RequestInit): Promise<ReponseGodac<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, refus: { code: "ERREUR", statut: 0, message: "Connexion impossible. Vérifiez le réseau puis réessayez." } };
  }
  const corps: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, refus: lireRefus(res.status, corps) };
  return { ok: true, data: corps as T, statut: res.status };
}

/** Action proposée pour un refus, selon le rôle de la personne. */
export function actionRefus(refus: Refus, direction: boolean): { href: string; libelle: string } | null {
  switch (refus.code) {
    case "NON_CONNECTE":
      return { href: "/sign-in", libelle: "Se reconnecter" };
    case "MODULE_INACTIF":
      return direction && refus.module ? { href: `/admin/abonnement?vue=modules#module-${refus.module}`, libelle: "Activer ce module" } : null;
    case "LIMITE_FORMULE":
      return direction ? { href: "/admin/abonnement", libelle: "Changer de formule" } : null;
    case "QUOTA_ATTEINT":
      return direction ? { href: "/admin/abonnement?vue=consommation", libelle: "Voir la consommation" } : null;
    default:
      return null;
  }
}

/** Titre court de l'état. */
export function titreRefus(refus: Refus): string {
  switch (refus.code) {
    case "NON_CONNECTE":
      return "Session expirée";
    case "ROLE_REFUSE":
      return "Action réservée";
    case "MODULE_INACTIF":
      return "Module non activé";
    case "LIMITE_FORMULE":
      return "Limite de votre formule atteinte";
    case "QUOTA_ATTEINT":
      return "Quota atteint";
    default:
      return "Action impossible";
  }
}
