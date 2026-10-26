/**
 * Recherche globale (Ctrl+K) : pages et fonctions autorisées pour le rôle
 * (issues du catalogue : jamais une page non autorisée) et entités du
 * périmètre (chauffeurs, véhicules, tournées). Fichier pur, testé dans
 * lib/recherche/__tests__/recherche.test.ts ; les entités sont lues par
 * app/api/recherche/route.ts sous la RLS de la personne connectée.
 *
 * Droits des entités : exploitation et direction, toute l'organisation ;
 * manager, ses services (chauffeurs de ses services, véhicules et tournées
 * de ses services) ; chauffeur et comptable, pages seulement.
 */
import { ECRANS, SECTIONS, urlDe, type Ecran } from "@/lib/acces/catalogue";
import { ecranOuvrable, type ContexteAccueil } from "@/lib/acces/tuiles-accueil";

/** Nombre minimal de caractères pour chercher des entités. */
export const MIN_ENTITES = 2;
/** Résultats au plus par catégorie. */
export const MAX_PAR_CATEGORIE = 8;
export const LONGUEUR_MAX = 60;

export const ROLES_ENTITES: readonly string[] = ["manager", "exploitation", "direction"];
export const peutChercherEntites = (role: string) => ROLES_ENTITES.includes(role);

/** Minuscules sans accents ni ponctuation superflue : « Tournée » = « tournee ». */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Texte saisi nettoyé : espaces réduits, bornée ; sert de base à la requête. */
export function nettoyerSaisie(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, LONGUEUR_MAX);
}

/**
 * Motif sûr pour un filtre PostgREST `ilike` : lettres, chiffres et
 * espaces seulement (virgules, parenthèses, jokers et guillemets retirés),
 * séparateurs remplacés par un joker (« aa 123 » trouve « AA-123-AB »).
 */
export function motifIlike(saisie: string): string | null {
  const mots = nettoyerSaisie(saisie).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  const motif = mots.join("%");
  return motif.length >= MIN_ENTITES ? `%${motif}%` : null;
}

export interface ResultatPage {
  id: string;
  libelle: string;
  section: string;
  href: string;
}

/** Écrans du catalogue qui s'ouvrent pour ce contexte (rôle, conduite, modules), hors pages à identifiant. */
export function pagesAutorisees(ctx: ContexteAccueil): Ecran[] {
  return ECRANS.filter((e) => !/\[|:/.test(e.href) && e.menu !== "cache" && ecranOuvrable(e.id, ctx));
}

/** Pages dont le libellé (ou l'onglet) contient la saisie ; sans saisie, les premières du menu. Jamais une page non autorisée. */
export function chercherPages(ctx: ContexteAccueil, saisie: string, max = MAX_PAR_CATEGORIE): ResultatPage[] {
  const q = normaliser(saisie);
  const section = (id: string) => SECTIONS.find((s) => s.id === id)?.libelle ?? "";
  const mots = q ? q.split(" ") : [];
  return pagesAutorisees(ctx)
    .map((e) => {
      const cible = normaliser(`${e.libelle} ${e.libelleOnglet ?? ""} ${e.libelleSousOnglet ?? ""} ${section(e.section)}`);
      const titre = normaliser(e.libelle);
      const ok = mots.every((m) => cible.includes(m));
      // Titre qui commence par la saisie d'abord, puis titre qui la contient, puis le reste.
      const rang = !q ? 2 : titre.startsWith(q) ? 0 : mots.every((m) => titre.includes(m)) ? 1 : 2;
      return { e, ok, rang };
    })
    .filter((x) => x.ok)
    .sort((a, b) => a.rang - b.rang)
    .slice(0, max)
    .map(({ e }) => ({ id: e.id, libelle: e.libelle, section: section(e.section), href: urlDe(e.id) }));
}

export type CategorieEntite = "chauffeurs" | "vehicules" | "tournees";

export interface ResultatEntite {
  id: string;
  libelle: string;
  detail: string | null;
  href: string;
}

/** Catégories d'entités ouvertes à ce contexte : le lien ne mène qu'à un écran qui s'ouvre. */
export function categoriesEntites(ctx: ContexteAccueil): CategorieEntite[] {
  if (!peutChercherEntites(ctx.role)) return [];
  const c: CategorieEntite[] = [];
  if (ecranOuvrable("equipe.utilisateurs", ctx) && ecranOuvrable("equipe.utilisateur_fiche", ctx)) c.push("chauffeurs");
  if (ecranOuvrable("flotte.vehicules", ctx) && ecranOuvrable("flotte.vehicule_fiche", ctx)) c.push("vehicules");
  if (ecranOuvrable("exploitation.planning", ctx)) c.push("tournees");
  return c;
}

/** Limite et borne une liste de résultats. */
export const limiter = <T,>(l: readonly T[], max = MAX_PAR_CATEGORIE): T[] => l.slice(0, max);
