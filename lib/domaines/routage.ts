/**
 * Routage par domaine : un seul déploiement sert la vitrine (godac.fr) et
 * l'application (godac.app). Logique pure (aucun accès réseau ni cookie) :
 * middleware.ts lui passe l'hôte, le chemin et l'état de connexion.
 *
 * Règles :
 *  - godac.fr (+ www)  : seule la vitrine (VITRINE_PATHS) est servie ; toute autre
 *    page est redirigée en 308 vers le même chemin (et la même query) sur godac.app.
 *  - godac.app (+ www) : « / » redirige en 307 vers /sign-in (non connecté) ou
 *    /dashboard (connecté). Les pages de la vitrine restent accessibles.
 *  - tout autre hôte (godac-v2.vercel.app, localhost, previews) : aucun changement.
 *  - Jamais de redirection pour /api/** (webhooks Stripe/Supabase, crons Vercel),
 *    /_next/**, fichiers statiques, manifest, service worker, /.well-known.
 */

export const VITRINE_URL = "https://godac.fr";
export const APP_URL = "https://godac.app";

export const HOTES_VITRINE = ["godac.fr", "www.godac.fr"] as const;
export const HOTES_APP = ["godac.app", "www.godac.app"] as const;

/** Page de connexion de l'application (la route existante est /sign-in). */
export const CHEMIN_CONNEXION = "/sign-in";
/** Accueil de l'espace connecté. */
export const CHEMIN_TABLEAU_DE_BORD = "/dashboard";

/**
 * Pages servies sur godac.fr (vitrine, marketing, légales). Il n'existe pas de
 * page /tarifs : l'offre est présentée dans /modules et /bon-de-commande.
 */
export const VITRINE_PATHS: readonly string[] = [
  "/",
  "/modules",
  "/contact",
  "/bon-de-commande",
  "/cgv",
  "/cgu",
  "/sla",
  "/dpa",
  "/confidentialite",
  "/mentions-legales",
];

/** Fichiers de référencement, servis sur tous les hôtes (contenu adapté à l'hôte). */
const FICHIERS_SEO = ["/robots.txt", "/sitemap.xml"];

/** Chemins exacts jamais redirigés. */
const PASSER_EXACT = [
  "/manifest.webmanifest",
  "/manifest.json",
  "/sw.js",
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  ...FICHIERS_SEO,
];

/** Préfixes jamais redirigés (API, webhooks, crons, assets, WebAuthn). */
const PASSER_PREFIXES = ["/api/", "/_next/", "/brand/", "/zxing/", "/.well-known/"];

export type TypeHote = "vitrine" | "app" | "autre";

export type DecisionDomaine =
  | { action: "passer" }
  | { action: "rediriger"; status: 307 | 308; url: string };

/** Hôte « propre » : en-tête x-forwarded-host prioritaire, 1re valeur, sans port, en minuscules. */
export function normaliserHote(host: string | null | undefined, forwardedHost?: string | null): string {
  const brut = (forwardedHost?.trim() ? forwardedHost : host) ?? "";
  const premier = brut.split(",")[0]?.trim().toLowerCase() ?? "";
  return premier.replace(/:\d+$/, "").replace(/\.$/, "");
}

export function typeHote(hote: string): TypeHote {
  if ((HOTES_VITRINE as readonly string[]).includes(hote)) return "vitrine";
  if ((HOTES_APP as readonly string[]).includes(hote)) return "app";
  return "autre";
}

/** Chemin sans slash final (sauf « / »). */
function normaliserChemin(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname || "/";
}

/** Vrai pour /api/**, /_next/**, fichiers statiques, manifest, sw, SEO : jamais redirigés. */
export function estCheminTechnique(pathname: string): boolean {
  const p = pathname === "/api" ? "/api/" : pathname;
  if (PASSER_EXACT.includes(p)) return true;
  if (PASSER_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  // Fichier statique : dernier segment avec extension (logo.png, sw.js, font.woff2…).
  return /\.[a-z0-9]{1,8}$/i.test(p.split("/").pop() ?? "");
}

export function estPageVitrine(pathname: string): boolean {
  return VITRINE_PATHS.includes(normaliserChemin(pathname));
}

/** URL canonique d'une page de la vitrine (toujours sur godac.fr), ou null si ce n'est pas une page vitrine. */
export function urlCanoniqueVitrine(pathname: string): string | null {
  if (!estPageVitrine(pathname)) return null;
  const p = normaliserChemin(pathname);
  return p === "/" ? VITRINE_URL : `${VITRINE_URL}${p}`;
}

/** Adresse de base à utiliser pour les liens absolus (sitemap, robots) selon l'hôte de la requête. */
export function urlSitePourHote(hote: string, urlParDefaut: string): string {
  const type = typeHote(hote);
  if (type === "vitrine") return VITRINE_URL;
  if (type === "app") return APP_URL;
  return urlParDefaut;
}

export interface EntreeRoutage {
  /** Valeur de l'en-tête host (ou hôte déjà normalisé). */
  host: string | null | undefined;
  forwardedHost?: string | null;
  pathname: string;
  /** Query string avec « ? » initial, ou chaîne vide. */
  search?: string;
  /**
   * true / false si la session est connue ; null / undefined si elle n'a pas encore été lue
   * (aucune décision dépendante de la session n'est alors prise : « / » est laissé passer).
   */
  connecte?: boolean | null;
}

export function decideRoutageDomaine(entree: EntreeRoutage): DecisionDomaine {
  const hote = normaliserHote(entree.host, entree.forwardedHost);
  const type = typeHote(hote);
  const pathname = entree.pathname || "/";
  const search = entree.search ?? "";

  if (type === "autre") return { action: "passer" };
  if (estCheminTechnique(pathname)) return { action: "passer" };

  if (type === "vitrine") {
    if (estPageVitrine(pathname)) return { action: "passer" };
    return { action: "rediriger", status: 308, url: `${APP_URL}${pathname}${search}` };
  }

  // Hôte application.
  if (normaliserChemin(pathname) === "/" && typeof entree.connecte === "boolean") {
    const cible = entree.connecte ? CHEMIN_TABLEAU_DE_BORD : CHEMIN_CONNEXION;
    return { action: "rediriger", status: 307, url: `${APP_URL}${cible}` };
  }
  return { action: "passer" };
}
