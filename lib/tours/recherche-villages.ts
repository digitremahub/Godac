/**
 * Recherche d'un village dans les fiches de tournées, côté client : les
 * tournées et leurs villages sont déjà chargés par la page. Insensible à la
 * casse, aux accents, aux tirets et apostrophes : « saint etienne » trouve
 * « Saint-Étienne » (les abréviations comme « St » ne sont pas devinées).
 * Une saisie en chiffres est cherchée au début du code postal.
 */

export interface VillageCherchable {
  id?: string;
  name: string;
  postal_code: string | null;
}

export interface TourneeCherchable {
  id: string;
  tourNumber: string;
  villages: VillageCherchable[];
  /** Renfort : villages d'autres tournées couverts par défaut. */
  renfortVillageIds?: string[];
}

/** Minuscules, sans accents, tirets et apostrophes remplacés par des espaces. */
export function normaliserRecherche(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[-'’_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Le village correspond-il à la recherche (déjà normalisée) ? */
export function villageCorrespond(v: VillageCherchable, q: string): boolean {
  if (!q) return false;
  const compact = q.replace(/\s/g, "");
  if (/^\d+$/.test(compact)) return (v.postal_code ?? "").replace(/\s/g, "").startsWith(compact);
  return normaliserRecherche(v.name).includes(q);
}

/** Clé stable d'un village dans une tournée (id, sinon position). */
export const cleVillage = (routeId: string, v: VillageCherchable, index: number) => `${routeId}:${v.id ?? `#${index}`}`;

export interface ResultatRecherche {
  /** Recherche active (au moins un caractère utile). */
  active: boolean;
  /** Tournées à afficher, dans l'ordre reçu. */
  routeIds: Set<string>;
  /** Villages à mettre en évidence (clés `cleVillage`). */
  villages: Set<string>;
  /** Nombre de villages trouvés (toutes tournées). */
  nbVillages: number;
}

/**
 * Tournées contenant un village qui correspond (ou dont le numéro
 * correspond), et les villages à mettre en évidence. Une tournée de renfort
 * apparaît aussi si elle couvre par défaut un village trouvé.
 */
export function rechercherVillages(routes: TourneeCherchable[], recherche: string): ResultatRecherche {
  const q = normaliserRecherche(recherche);
  const routeIds = new Set<string>();
  const villages = new Set<string>();
  if (!q) return { active: false, routeIds, villages, nbVillages: 0 };

  const villageIdsTrouves = new Set<string>();
  for (const r of routes) {
    r.villages.forEach((v, i) => {
      if (villageCorrespond(v, q)) {
        villages.add(cleVillage(r.id, v, i));
        routeIds.add(r.id);
        if (v.id) villageIdsTrouves.add(v.id);
      }
    });
    if (normaliserRecherche(r.tourNumber).includes(q)) routeIds.add(r.id);
  }
  for (const r of routes) if ((r.renfortVillageIds ?? []).some((id) => villageIdsTrouves.has(id))) routeIds.add(r.id);
  return { active: true, routeIds, villages, nbVillages: villages.size };
}
