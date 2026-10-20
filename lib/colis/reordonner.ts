// Glisser-déposer des arrêts d'une tournée colis : calcul pur du nouvel
// ordre (positions globales et contiguës 0, 1, 2… de la tournée, comme
// après l'optimisation) quand un arrêt est déposé avant un autre arrêt, ou
// en fin d'une liste (village). Testé dans lib/colis/__tests__/reordonner.test.ts.

export interface ArretOrdonne {
  id: string;
  position: number;
  /** Absent ou null : arrêt sans liste. */
  list_id?: string | null;
}

export interface CibleDepot {
  /** Liste (village) de destination ; null : arrêts sans liste. */
  list_id: string | null;
  /** Arrêt devant lequel déposer ; null : en fin de la liste de destination. */
  avant_id: string | null;
}

export interface Changement {
  id: string;
  position: number;
  list_id: string | null;
}

/**
 * Nouvel ordre après dépôt. Ne renvoie que les arrêts dont la position ou
 * la liste change. Les arrêts déjà clôturés gardent leur place relative :
 * le « prochain arrêt » reste le premier arrêt à livrer dans l'ordre.
 * Renvoie [] si le dépôt est impossible (arrêt ou cible inconnus) ou ne
 * change rien.
 */
export function reordonner(arrets: readonly ArretOrdonne[], id: string, cible: CibleDepot): Changement[] {
  const tries = [...arrets].map((a) => ({ id: a.id, position: a.position, list_id: a.list_id ?? null })).sort((a, b) => a.position - b.position);
  const deplace = tries.find((a) => a.id === id);
  if (!deplace) return [];
  if (cible.avant_id === id) return [];
  const reste = tries.filter((a) => a.id !== id);
  let index: number;
  if (cible.avant_id) {
    index = reste.findIndex((a) => a.id === cible.avant_id);
    if (index < 0) return [];
    const avant = reste[index]!;
    // Déposé devant un arrêt : il rejoint la liste de cet arrêt.
    if (avant.list_id !== cible.list_id) cible = { ...cible, list_id: avant.list_id };
  } else {
    // Fin de la liste : après le dernier arrêt de cette liste, sinon
    // après le dernier arrêt de la liste précédente (ordre des listes
    // inconnu ici : en fin de tournée par défaut).
    let dernier = -1;
    reste.forEach((a, i) => {
      if (a.list_id === cible.list_id) dernier = i;
    });
    index = dernier >= 0 ? dernier + 1 : reste.length;
  }
  const nouvel = [...reste.slice(0, index), { ...deplace, list_id: cible.list_id }, ...reste.slice(index)];
  const avantParId = new Map(tries.map((a) => [a.id, a]));
  const changements: Changement[] = [];
  nouvel.forEach((a, i) => {
    const ancien = avantParId.get(a.id)!;
    if (ancien.position !== i || ancien.list_id !== a.list_id) changements.push({ id: a.id, position: i, list_id: a.list_id });
  });
  return changements;
}

/** Ordre local (affichage optimiste) : arrêts triés avec les changements appliqués. */
export function appliquerChangements<T extends ArretOrdonne>(arrets: readonly T[], changements: readonly Changement[]): T[] {
  const par = new Map(changements.map((c) => [c.id, c]));
  return arrets.map((a) => (par.has(a.id) ? { ...a, position: par.get(a.id)!.position, list_id: par.get(a.id)!.list_id } : a)).sort((a, b) => a.position - b.position);
}

/**
 * Cible d'un dépôt à partir de l'élément survolé (glisser-déposer) dans
 * une liste affichée `ordre` : en descendant, l'arrêt se place APRÈS
 * l'arrêt survolé ; en montant, AVANT lui. La liste de destination est
 * celle de l'arrêt survolé.
 */
export function cibleDepuisSurvol(ordre: readonly { id: string; list_id: string | null }[], activeId: string, overId: string): CibleDepot | null {
  if (activeId === overId) return null;
  const de = ordre.findIndex((x) => x.id === activeId);
  const vers = ordre.findIndex((x) => x.id === overId);
  if (de < 0 || vers < 0) return null;
  const survole = ordre[vers]!;
  if (de < vers) {
    const suivant = ordre.slice(vers + 1).find((x) => x.id !== activeId && x.list_id === survole.list_id);
    return { list_id: survole.list_id, avant_id: suivant?.id ?? null };
  }
  return { list_id: survole.list_id, avant_id: survole.id };
}
