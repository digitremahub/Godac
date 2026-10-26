// Recherche d'un arrêt (feuille « tous les arrêts » de GO, liste de la
// préparation) : l'arrêt trouvé s'affiche directement, sans clic de plus.
//  - un seul résultat : il est sélectionné tout seul ;
//  - Entrée : le premier résultat est sélectionné ;
//  - dans la saisie d'une nouvelle adresse, Entrée choisit la suggestion
//    surlignée, à défaut la première.
// Logique pure, testée dans lib/colis/__tests__/recherche-arret.test.ts.

/** Nombre de caractères à partir duquel un résultat unique s'affiche tout seul (évite de sauter sur une lettre). */
export const MIN_CARACTERES_AUTO = 3;

/** Terme de recherche normalisé (espaces de bord retirés, minuscules françaises). */
export const termeRecherche = (saisie: string) => saisie.trim().toLocaleLowerCase("fr-FR");

/** L'une des valeurs contient le terme (terme vide : tout correspond). */
export function correspondA(valeurs: readonly (string | null | undefined)[], terme: string): boolean {
  return !terme || valeurs.some((v) => (v ?? "").toLocaleLowerCase("fr-FR").includes(terme));
}

/**
 * Arrêt à afficher d'office pour une recherche : `validation` (Entrée) prend le
 * premier résultat ; sinon seulement un résultat unique, une fois le terme
 * assez long. `null` : rien à afficher, la liste filtrée reste affichée.
 */
export function arretAAfficher(ids: readonly string[], terme: string, validation = false): string | null {
  if (terme.length === 0 || ids.length === 0) return null;
  if (validation) return ids[0]!;
  return ids.length === 1 && terme.length >= MIN_CARACTERES_AUTO ? ids[0]! : null;
}

/** Suggestion choisie par Entrée : la surlignée (flèches), sinon la première ; -1 : aucune suggestion. */
export function suggestionValidee(actif: number, nombre: number): number {
  if (nombre <= 0) return -1;
  return actif >= 0 && actif < nombre ? actif : 0;
}
