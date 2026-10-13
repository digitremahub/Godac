/**
 * Lit toutes les lignes d'une requête Supabase page par page (PostgREST
 * plafonne chaque réponse, souvent à 1 000 lignes) au lieu d'un
 * `.limit()` qui tronquait silencieusement les totaux. `build` doit
 * reconstruire la requête à chaque appel (un builder ne se réutilise
 * pas) et l'ordonner sur une clé stable. Au-delà de `maxRows`, s'arrête
 * et renvoie `truncated: true` pour que la page l'affiche.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { pageSize = 1000, maxRows = 50000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; truncated: boolean; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, Math.min(from + pageSize, maxRows) - 1);
    if (error) return { rows, truncated: false, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}
