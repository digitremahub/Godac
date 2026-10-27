// Journal léger des erreurs d'affichage (error.tsx / global-error.tsx).
// Logique pure partagée par le navigateur (envoi) et le serveur (réception) :
// elle retire tout ce qui pourrait identifier une personne avant stockage.
// Testée dans lib/observabilite/__tests__/erreurs-client.test.ts.

export const ORIGINES_ERREUR = ["racine", "global", "dashboard", "livreur"] as const;
export type OrigineErreur = (typeof ORIGINES_ERREUR)[number];

export const MESSAGE_ERREUR_MAX = 300;
export const DIGEST_ERREUR_MAX = 80;
export const CHEMIN_ERREUR_MAX = 200;
/** Taille maximale du corps reçu : un rapport d'erreur tient en quelques centaines d'octets. */
export const CORPS_ERREUR_MAX = 4000;

export interface RapportErreur {
  origine: OrigineErreur;
  message: string;
  digest: string | null;
  chemin: string;
}

/** Retire adresses e-mail, identifiants, longues suites de chiffres et paramètres d'URL du texte. */
export function assainirTexte(texte: string, max: number = MESSAGE_ERREUR_MAX): string {
  return texte
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .replace(/\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|[A-Za-z0-9_-]{32,})\b/g, "[jeton]")
    .replace(/\+?\d[\d\s.-]{7,}\d/g, "[nombre]")
    .replace(/\?[^\s"')]*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Chemin de la page sans paramètres ni identifiants (/colis/123 → /colis/:id). */
export function assainirChemin(chemin: string): string {
  const sansParametres = chemin.split(/[?#]/)[0] ?? "";
  return sansParametres
    .split("/")
    .map((segment) => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) || /^\d{3,}$/.test(segment) ? ":id" : segment))
    .join("/")
    .slice(0, CHEMIN_ERREUR_MAX);
}

/** Rapport reçu → rapport assaini, ou null s'il est inexploitable. */
export function assainirRapport(brut: unknown): RapportErreur | null {
  if (!brut || typeof brut !== "object") return null;
  const r = brut as Record<string, unknown>;
  if (!ORIGINES_ERREUR.includes(r.origine as OrigineErreur)) return null;
  const message = typeof r.message === "string" ? assainirTexte(r.message) : "";
  if (!message) return null;
  return {
    origine: r.origine as OrigineErreur,
    message,
    digest: typeof r.digest === "string" && r.digest ? assainirTexte(r.digest, DIGEST_ERREUR_MAX) : null,
    chemin: typeof r.chemin === "string" ? assainirChemin(r.chemin) : "",
  };
}
