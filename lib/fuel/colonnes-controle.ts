import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/** Colonne de la migration 20261108000003 : contrôle de saisie confirmé par le chauffeur. */
export const COLONNE_CONTROLE = "controle_confirme";

/**
 * Lit les pleins avec la colonne `controle_confirme` ; tant que la migration
 * 20261108000003 n'est pas appliquée, la lecture est refaite sans elle (les
 * écarts de contrôle confirmé n'apparaissent simplement pas).
 */
export async function avecColonneControle<R extends { error: { code?: string | null; message?: string | null } | null }>(
  lire: (colonnes: string) => PromiseLike<R>,
  colonnes: string,
): Promise<R> {
  const r = await lire(`${colonnes}, ${COLONNE_CONTROLE}`);
  if (r.error && estSchemaManquant(r.error)) return lire(colonnes);
  return r;
}
