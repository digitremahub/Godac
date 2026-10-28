// Parcours d'un préfixe de stockage (pur côté logique : le client est injecté, testé avec un faux client).

export interface ClientStockageMinimal {
  list(chemin: string, options?: { limit?: number; offset?: number }): PromiseLike<{ data: { name: string; id?: string | null }[] | null; error: { message: string } | null }>;
}

const PAGE = 1000;
const PROFONDEUR_MAX = 8;

/**
 * Tous les fichiers sous `prefixe` (sous-dossiers compris), sans les dossiers.
 * Une entrée sans identifiant est un dossier. Lève une erreur si une lecture échoue :
 * il vaut mieux ne rien supprimer qu'oublier des fichiers.
 */
export async function listerFichiers(bucket: ClientStockageMinimal, prefixe: string, profondeur = 0): Promise<string[]> {
  if (profondeur > PROFONDEUR_MAX) throw new Error(`arborescence trop profonde sous ${prefixe}`);
  const fichiers: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefixe, { limit: PAGE, offset });
    if (error) throw new Error(error.message);
    const entrees = data ?? [];
    for (const e of entrees) {
      const chemin = `${prefixe}/${e.name}`;
      if (e.id) fichiers.push(chemin);
      else fichiers.push(...(await listerFichiers(bucket, chemin, profondeur + 1)));
    }
    if (entrees.length < PAGE) return fichiers;
  }
}
