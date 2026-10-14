/**
 * Tournées de renfort — calculs purs (sans base ni DOM).
 *
 * Une tournée de renfort part avec des colis pour des villages qui
 * appartiennent à d'autres tournées du même service. Chaque village
 * garde sa tournée d'origine : le renfort ne fait que l'emprunter.
 *
 * - Couverture par défaut : tour_route_renfort_villages.
 * - Couverture du jour : planning_entry_renfort_villages, pour un
 *   passage planifié précis ; aucune ligne ce jour-là = couverture par
 *   défaut.
 */

/** Une tournée telle que vue par les calculs de renfort. */
export interface RenfortRoute {
  id: string;
  tourNumber: string;
  serviceId: string | null;
  isRenfort: boolean;
  villages: { id?: string }[];
}

/**
 * Les tournées dont un renfort peut emprunter les villages : les autres
 * tournées (pas de renfort) du même service. Un renfort sans service
 * peut emprunter partout ; une tournée « tous services » est empruntable
 * par tous.
 */
export function renfortCandidates<R extends RenfortRoute>(routes: R[], renfort: Pick<RenfortRoute, "id" | "serviceId">): R[] {
  return routes.filter((r) => r.id !== renfort.id && !r.isRenfort && (!renfort.serviceId || !r.serviceId || r.serviceId === renfort.serviceId));
}

/** Ne garde que les villages empruntables (appartenant à une tournée candidate), sans doublon, dans l'ordre donné. */
export function sanitizeRenfortVillageIds(villageIds: string[], candidates: RenfortRoute[]): string[] {
  const allowed = new Set(candidates.flatMap((r) => r.villages.map((v) => v.id).filter((id): id is string => Boolean(id))));
  return Array.from(new Set(villageIds)).filter((id) => allowed.has(id));
}

/** Un passage planifié d'une tournée de renfort, le jour affiché. */
export interface RenfortEntry {
  planningEntryId: string;
  renfortRouteId: string;
  tourNumber: string;
}

export interface EntryCoverage {
  villageIds: string[];
  /** true : choix propre à ce jour ; false : couverture par défaut du renfort. */
  specific: boolean;
}

/**
 * Les villages couverts par chaque passage de renfort : ceux choisis pour
 * ce jour s'il y en a, sinon la couverture par défaut de la tournée.
 */
export function coverageForEntries(
  entries: RenfortEntry[],
  defaultLinks: { renfortRouteId: string; villageId: string }[],
  dayLinks: { planningEntryId: string; villageId: string }[],
): Map<string, EntryCoverage> {
  const defaults = new Map<string, string[]>();
  for (const l of defaultLinks) defaults.set(l.renfortRouteId, [...(defaults.get(l.renfortRouteId) ?? []), l.villageId]);
  const days = new Map<string, string[]>();
  for (const l of dayLinks) days.set(l.planningEntryId, [...(days.get(l.planningEntryId) ?? []), l.villageId]);
  const out = new Map<string, EntryCoverage>();
  for (const e of entries) {
    const day = days.get(e.planningEntryId);
    out.set(e.planningEntryId, day?.length ? { villageIds: Array.from(new Set(day)), specific: true } : { villageIds: Array.from(new Set(defaults.get(e.renfortRouteId) ?? [])), specific: false });
  }
  return out;
}

/**
 * Pour chaque village, les tournées de renfort qui le couvrent ce jour-là
 * (numéros triés, sans doublon) — affiché « en renfort par la tournée X »
 * sur sa tournée d'origine.
 */
export function renfortByVillage(entries: RenfortEntry[], coverage: Map<string, EntryCoverage>): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const e of entries) {
    for (const id of coverage.get(e.planningEntryId)?.villageIds ?? []) {
      const set = out.get(id) ?? new Set<string>();
      set.add(e.tourNumber);
      out.set(id, set);
    }
  }
  return new Map(Array.from(out.entries()).map(([id, set]) => [id, Array.from(set).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }))] as const));
}

/** « en renfort par la tournée T9 » / « en renfort par les tournées T9, T12 ». */
export function renfortLabel(tourNumbers: string[]): string {
  if (!tourNumbers.length) return "";
  return tourNumbers.length === 1 ? `en renfort par la tournée ${tourNumbers[0]}` : `en renfort par les tournées ${tourNumbers.join(", ")}`;
}
