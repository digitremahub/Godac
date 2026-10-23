/**
 * Lecture tolérante des colonnes ajoutées par des migrations successives —
 * pur, testé. On demande toutes les colonnes ; si la base répond qu'une
 * colonne n'existe pas, on retire le groupe de colonnes qui la contient et
 * on recommence (au plus un essai par groupe).
 */

/** Nom de la colonne manquante d'après le message d'erreur PostgREST / Postgres, ou null. */
export function colonneManquante(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = /column\s+(?:"?[\w]+"?\.)*"?(\w+)"?\s+does not exist/i.exec(message) ?? /Could not find the '(\w+)' column/i.exec(message);
  return m ? m[1]! : null;
}

/** Groupes sans celui qui contient la colonne manquante (inchangés si aucun ne la contient). */
export function groupesSansColonne(groupes: readonly string[], colonne: string): string[] {
  return groupes.filter((g) => !g.split(",").some((c) => c.trim() === colonne));
}

export function selection(base: string, groupes: readonly string[]): string {
  return [base, ...groupes].join(", ");
}
