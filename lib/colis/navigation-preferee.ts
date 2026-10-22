/**
 * Navigation préférée du chauffeur pour le guidage vers l'arrêt :
 * GO Navigation (par défaut), Waze ou Google Maps. Mémorisée sur le
 * téléphone (localStorage) ; les étapes de livraison, preuves et l'ordre
 * des arrêts restent dans GODAC quel que soit le choix.
 *
 * Logique pure, testée dans lib/colis/__tests__/navigation-preferee.test.ts.
 */

export type NavigationPreferee = "go" | "waze" | "gmaps";

export const CLE_NAVIGATION_PREFEREE = "godac.livreur.navigation";

export const NAVIGATIONS: readonly { id: NavigationPreferee; libelle: string }[] = [
  { id: "go", libelle: "GO Navigation" },
  { id: "waze", libelle: "Waze" },
  { id: "gmaps", libelle: "Google Maps" },
];

/** Valeur mémorisée → choix ; GO Navigation si absente ou inconnue. */
export function lireNavigationPreferee(valeur: string | null | undefined): NavigationPreferee {
  return valeur === "waze" || valeur === "gmaps" ? valeur : "go";
}

export function libelleNavigation(n: NavigationPreferee): string {
  return NAVIGATIONS.find((x) => x.id === n)!.libelle;
}
