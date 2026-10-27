/**
 * Vocabulaire carburant affiché, d'un seul endroit. Seul l'AFFICHAGE change :
 * les valeurs stockées (cuve « diesel », produit « gazole ») restent celles de
 * la base. « Gazole » est le mot employé partout, y compris pour une cuve
 * enregistrée « diesel ».
 */
export const LIBELLES_CARBURANT: Readonly<Record<string, string>> = {
  diesel: "Gazole",
  gazole: "Gazole",
  adblue: "AdBlue",
};

export function libelleCarburant(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  return LIBELLES_CARBURANT[valeur.toLowerCase()] ?? valeur;
}
