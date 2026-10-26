// Sortie de GO Navigation : où arrive le chauffeur quand il ferme GO (bouton
// « ‹ », « Retour à la tournée », retour du navigateur ou du téléphone).
// Toujours sur l'écran « Ma tournée colis » (/livreur), jamais sur le tableau
// de bord, même quand GO a été ouvert par un lien direct ou depuis le tableau
// de bord, et sur son étape PRÉPARER (scan, adresses, listes, « Ajouter ou
// modifier des colis »), même tournée démarrée : un bouton « Reprendre GO »
// y ramène en un clic. Logique pure, testée dans
// lib/colis/__tests__/sortie-go.test.ts.

/** Écran « Ma tournée colis » du chauffeur (étapes du parcours, lib/colis/parcours.ts). */
export const ROUTE_TOURNEE = "/livreur";
/** Lien direct vers GO Navigation (tableau de bord, accueil GO, raccourcis). */
export const ROUTE_GO = "/livreur/navigation";

/** Marque posée dans l'historique du navigateur à l'ouverture de GO : le retour la retire et ferme GO. */
export const MARQUE_HISTORIQUE_GO = "godacGo";

/**
 * Écran affiché une fois GO fermé : la préparation de la tournée colis
 * (`afficherPreparation(etape, true)` vaut vrai à toutes les étapes), et la
 * vue « Arrêts » en dessous pour « Retour à la livraison ».
 */
export const ECRAN_APRES_GO = { preparationDemandee: true, vue: "liste" } as const;
/** Écran de « Reprendre GO » depuis la préparation : GO rouvert, préparation refermée. */
export const ECRAN_REPRISE_GO = { preparationDemandee: false, vue: "navigation" } as const;

const sansSlashFinal = (chemin: string) => (chemin.length > 1 ? chemin.replace(/\/+$/, "") : chemin);

/**
 * URL à afficher une fois GO fermé : « Ma tournée colis » quand GO a été ouvert
 * par son lien direct (la barre d'adresse et un rechargement ne rouvrent plus
 * GO), sinon `null` (l'adresse est déjà celle de la tournée).
 */
export function routeApresSortie(chemin: string): string | null {
  return sansSlashFinal(chemin) === ROUTE_GO ? ROUTE_TOURNEE : null;
}

/** L'entrée d'historique est celle que GO a posée à son ouverture. */
export function estEntreeGo(etat: unknown): boolean {
  return typeof etat === "object" && etat !== null && (etat as Record<string, unknown>)[MARQUE_HISTORIQUE_GO] === true;
}

/** Retour du navigateur (popstate) : GO se ferme quand l'entrée posée à son ouverture a été retirée. */
export function retourFermeGo(goOuvert: boolean, entreeGoPosee: boolean, etatApres: unknown): boolean {
  return goOuvert && entreeGoPosee && !estEntreeGo(etatApres);
}
