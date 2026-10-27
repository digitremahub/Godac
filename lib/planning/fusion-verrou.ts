/**
 * Tournées d'origine d'une fusion : cases VERROUILLÉES du planning (logique
 * pure, testée dans __tests__/fusion-verrou.test.ts).
 *
 * Contexte : une ligne de planning « hôte » (par exemple la n°106 du lundi)
 * porte la liste des tournées d'origine qu'elle regroupe (n°105…,
 * planning_entry_merged_routes, lib/planning/fusion.ts). Ce jour-là, chaque
 * tournée d'origine du même service n'est plus une case à remplir : elle est
 * « fusionnée avec la n°106 » (état de case « fusionnee », lib/planning/
 * affectation.ts). Ni trou de couverture, ni « sans chauffeur », ni
 * affectable : cela évite les cases non affectées ET les doublons (le même
 * travail porté deux fois).
 *
 * La fusion reste une décision de l'encadrement : si une affectation existe
 * déjà sur une tournée d'origine, on ne refuse pas la fusion, on signale le
 * DOUBLON (écran, « À traiter », rappel du vendredi) et on propose de retirer
 * l'affectation.
 *
 * Clé d'une case : cleCaseTournee(cleLigne(service, tournée), jour de Paris),
 * la même que la grille (lib/planning/affectation.ts).
 */
import { jourDe, rangJour, JOURS_LONGS } from "@/lib/planning/semaine";

/** Ligne de planning telle que la lisent la grille, les routes et les crons. */
export interface EntreeVerrou {
  id: string;
  service_id: string | null;
  tour_number: string | number | null;
  start_at: string;
  status: string;
  driver_id?: string | null;
}

/** Fusion portée par une ligne hôte : les numéros de ses tournées d'origine. */
export interface FusionHote {
  entryId: string;
  tournees: readonly string[];
}

export interface VerrouFusion {
  /** Clé de la case verrouillée (service|tournée@jour). */
  cle: string;
  serviceId: string;
  /** Tournée d'origine (la case verrouillée). */
  tourNumber: string;
  /** Jour de Paris. */
  date: string;
  /** Ligne de planning hôte de la fusion. */
  hoteEntryId: string;
  /** Numéro de la tournée hôte (« 106 »). */
  hoteNumero: string;
}

const numero = (v: string | number | null | undefined) => String(v ?? "").trim();

/** Clé d'une case (même format que lib/planning/affectation.ts › cleCaseTournee(cleLigne(...), ...)). */
export const cleVerrou = (serviceId: string, tourNumber: string, date: string) => `${serviceId}|${tourNumber}@${date}`;

const estVraieTournee = (e: Pick<EntreeVerrou, "status" | "tour_number">) => e.status !== "cancelled" && e.status !== "presence" && !numero(e.tour_number).startsWith("PRESENCE-");

/**
 * Cases verrouillées par les fusions : pour chaque ligne hôte (non annulée),
 * ses tournées d'origine le MÊME jour de Paris et dans le MÊME service.
 *
 * - une tournée qui est elle-même hôte d'une fusion ce jour-là n'est jamais
 *   verrouillée (elle porte du travail : pas de chaîne de fusions) ;
 * - la tournée hôte listée parmi ses propres origines est ignorée ;
 * - une origine sans ligne de planning ce jour-là est verrouillée aussi (la
 *   case est vide, mais ne doit pas devenir un « trou » ni être remplie) ;
 * - deux hôtes pour la même origine : le plus petit numéro l'emporte
 *   (résultat stable).
 */
export function tourneesVerrouilleesParFusion(entrees: readonly EntreeVerrou[], fusions: readonly FusionHote[]): Map<string, VerrouFusion> {
  const parId = new Map(entrees.filter((e) => e.service_id && estVraieTournee(e)).map((e) => [e.id, e]));
  const hotes = fusions
    .map((f) => ({ entree: parId.get(f.entryId), origines: [...new Set(f.tournees.map(numero).filter(Boolean))] }))
    .filter((h): h is { entree: EntreeVerrou; origines: string[] } => Boolean(h.entree))
    .map((h) => ({ ...h, origines: h.origines.filter((t) => t !== numero(h.entree.tour_number)) }))
    .filter((h) => h.origines.length > 0)
    .sort((a, b) => numero(a.entree.tour_number).localeCompare(numero(b.entree.tour_number), "fr", { numeric: true }) || a.entree.id.localeCompare(b.entree.id));

  const casesHotes = new Set(hotes.map((h) => cleVerrou(h.entree.service_id!, numero(h.entree.tour_number), jourDe(h.entree.start_at))));
  const verrous = new Map<string, VerrouFusion>();
  for (const h of hotes) {
    const serviceId = h.entree.service_id!;
    const date = jourDe(h.entree.start_at);
    for (const origine of h.origines) {
      const cle = cleVerrou(serviceId, origine, date);
      if (casesHotes.has(cle) || verrous.has(cle)) continue;
      verrous.set(cle, { cle, serviceId, tourNumber: origine, date, hoteEntryId: h.entree.id, hoteNumero: numero(h.entree.tour_number) });
    }
  }
  return verrous;
}

/** Cette tournée, ce jour-là, est-elle fusionnée dans une autre ? */
export function verrouDe(verrous: ReadonlyMap<string, VerrouFusion>, serviceId: string, tourNumber: string, date: string): VerrouFusion | null {
  return verrous.get(cleVerrou(serviceId, tourNumber, date)) ?? null;
}

// ---------------------------------------------------------------------------
// Doublons : une affectation existe déjà sur une tournée d'origine.
// ---------------------------------------------------------------------------

export interface DoublonFusion {
  entryId: string;
  serviceId: string;
  /** Tournée d'origine affectée (n°105). */
  tourNumber: string;
  date: string;
  driverId: string;
  status: string;
  verrou: VerrouFusion;
}

/**
 * Affectations (chauffeur placé, tournée prévue ou en cours) qui portent une
 * tournée d'origine d'une fusion : le travail est compté deux fois. Les
 * tournées terminées ou annulées sont de l'historique, pas un doublon.
 */
export function doublonsFusion(entrees: readonly EntreeVerrou[], verrous: ReadonlyMap<string, VerrouFusion>): DoublonFusion[] {
  if (verrous.size === 0) return [];
  const out: DoublonFusion[] = [];
  for (const e of entrees) {
    if (!e.service_id || !e.driver_id || !estVraieTournee(e) || (e.status !== "planned" && e.status !== "in_progress")) continue;
    const verrou = verrouDe(verrous, e.service_id, numero(e.tour_number), jourDe(e.start_at));
    if (!verrou) continue;
    out.push({ entryId: e.id, serviceId: e.service_id, tourNumber: numero(e.tour_number), date: verrou.date, driverId: e.driver_id, status: e.status, verrou });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.tourNumber.localeCompare(b.tourNumber, "fr", { numeric: true }));
}

// ---------------------------------------------------------------------------
// Opérations en lot : recopie, génération, publication.
// ---------------------------------------------------------------------------

/**
 * Sépare les jours demandés pour une tournée : ceux où elle est fusionnée
 * (refusés, inchangés) et ceux où elle s'affecte normalement.
 */
export function partagerJours(verrous: ReadonlyMap<string, VerrouFusion>, serviceId: string, tourNumber: string, dates: readonly string[]): { libres: string[]; fusionnes: string[] } {
  const libres: string[] = [];
  const fusionnes: string[] = [];
  for (const d of dates) (verrouDe(verrous, serviceId, tourNumber, d) ? fusionnes : libres).push(d);
  return { libres, fusionnes };
}

/**
 * Copies demandées (duplication d'une affectation ou d'une semaine) : celles
 * dont la tournée d'origine est fusionnée, côté source (la tournée n'est pas
 * un vrai travail ce jour-là) comme côté cible (on n'affecte pas une tournée
 * fusionnée), sont écartées et comptées. La fusion elle-même n'est pas
 * recopiée : la duplication ne l'a jamais fait (lib/planning/semaine.ts ›
 * planifierCopies ne connaît que des affectations).
 */
export function ecarterFusionnees<T extends { source: { service_id: string; tour_number: string; start_at: string }; date: string }>(
  demandes: readonly T[],
  verrous: ReadonlyMap<string, VerrouFusion>,
): { gardees: T[]; fusionnees: T[] } {
  const gardees: T[] = [];
  const fusionnees: T[] = [];
  for (const d of demandes) {
    const s = d.source;
    const verrouille = verrouDe(verrous, s.service_id, s.tour_number, jourDe(s.start_at)) !== null || verrouDe(verrous, s.service_id, s.tour_number, d.date) !== null;
    (verrouille ? fusionnees : gardees).push(d);
  }
  return { gardees, fusionnees };
}

/** Clés « tournée|jour » (celles de lib/planning/semaines-auto.ts) des cases d'UN service verrouillées. */
export function clesTourneeJour(verrous: ReadonlyMap<string, VerrouFusion>, serviceId: string): Set<string> {
  const out = new Set<string>();
  for (const v of verrous.values()) if (v.serviceId === serviceId) out.add(`${v.tourNumber}|${v.date}`);
  return out;
}

/** Lignes qui ne sont pas portées par une case fusionnée (publication, rappels aux chauffeurs). */
export function sansFusionnees<T extends { service_id: string | null; tour_number: string | number | null; start_at: string }>(lignes: readonly T[], verrous: ReadonlyMap<string, VerrouFusion>): T[] {
  if (verrous.size === 0) return [...lignes];
  return lignes.filter((l) => !l.service_id || verrouDe(verrous, l.service_id, numero(l.tour_number), jourDe(l.start_at)) === null);
}

/** Ajoute `fusionnee` à chaque ligne (case verrouillée ce jour-là) : bandeau « à confirmer », cases à pourvoir. */
export function marquerFusionnees<T extends { service_id: string | null; tour_number: string | number | null; start_at: string }>(lignes: readonly T[], verrous: ReadonlyMap<string, VerrouFusion>): (T & { fusionnee: boolean })[] {
  return lignes.map((l) => ({ ...l, fusionnee: verrous.size > 0 && Boolean(l.service_id) && verrouDe(verrous, l.service_id!, numero(l.tour_number), jourDe(l.start_at)) !== null }));
}

// ---------------------------------------------------------------------------
// Textes.
// ---------------------------------------------------------------------------

/** Pastille de la case verrouillée : « Fusionnée avec n°106 ». */
export const libellePastille = (v: Pick<VerrouFusion, "hoteNumero">) => `Fusionnée avec n°${v.hoteNumero}`;

/** Message à la place du choix de chauffeur. */
export const messageVerrou = (v: Pick<VerrouFusion, "tourNumber" | "hoteNumero">) =>
  `Cette tournée est fusionnée avec la n°${v.hoteNumero} : modifiez la tournée ${v.hoteNumero}.`;

/** Refus d'une affectation (API, 409). */
export const messageRefusAffectation = (v: Pick<VerrouFusion, "tourNumber" | "hoteNumero" | "date">, libelleJour: (d: string) => string = (d) => d) =>
  `La tournée n°${v.tourNumber} est fusionnée avec la n°${v.hoteNumero} le ${libelleJour(v.date)} : elle ne s'affecte pas. Modifiez la tournée ${v.hoteNumero}, ou retirez la fusion.`;

/** « La tournée n°105 est déjà affectée à Dupont : retirez-le ou conservez la tournée séparée. » */
export const messageDoublon = (p: { tourNumber: string; nom: string | null | undefined; hoteNumero: string }) =>
  `La tournée n°${p.tourNumber} est déjà affectée à ${p.nom?.trim() || "un chauffeur"} : retirez-le ou conservez la tournée séparée (fusion avec la n°${p.hoteNumero}).`;

/** « 2 tournées fusionnées, inchangées » (compteur des opérations en lot). */
export const texteFusionnees = (n: number) => `${n} tournée${n > 1 ? "s" : ""} fusionnée${n > 1 ? "s" : ""}, inchangée${n > 1 ? "s" : ""}`;

/** « fusionnée avec 105, 107 » (null sans origine) : ce qu'ajoute le planning du chauffeur de la tournée hôte. */
export function fusionneeAvec(tourNumber: string | number, origines: readonly string[]): string | null {
  const autres = [...new Set(origines.map(numero).filter((t) => t && t !== numero(tourNumber)))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  return autres.length ? `fusionnée avec ${autres.join(", ")}` : null;
}

/** « Tournée n°106 (fusionnée avec 105) » : ce que voit le chauffeur de la tournée hôte (rien d'autre : ni la liste des villages des autres, ni leurs chauffeurs). */
export function libelleTourneeHote(tourNumber: string | number, origines: readonly string[]): string {
  const f = fusionneeAvec(tourNumber, origines);
  return f ? `Tournée n°${tourNumber} (${f})` : `Tournée n°${tourNumber}`;
}

/** Tournées d'origine regroupées par ligne hôte (à partir des cases verrouillées). */
export function originesParHote(verrous: ReadonlyMap<string, VerrouFusion>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of verrous.values()) out.set(v.hoteEntryId, [...(out.get(v.hoteEntryId) ?? []), v.tourNumber]);
  return out;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"] as const;

/** « lundi 9 novembre », « mardi 1er décembre ». */
export function libelleJourLong(date: string): string {
  const jour = Number(date.slice(8, 10));
  return `${JOURS_LONGS[rangJour(date)]} ${jour === 1 ? "1er" : jour} ${MOIS[Number(date.slice(5, 7)) - 1]}`;
}

const listeNumeros = (nums: readonly string[]) => {
  const l = nums.map((n) => `n°${n}`);
  return l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} et ${l.at(-1)}`;
};

/** « Tournée n°105 fusionnée avec la n°106 le lundi 9 novembre » (une alerte par fusion et par jour). */
export function messageAlerteFusion(p: { origines: readonly string[]; hoteNumero: string; date: string }): string {
  const origines = [...new Set(p.origines.map(numero).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  return `${origines.length > 1 ? "Tournées" : "Tournée"} ${listeNumeros(origines)} ${origines.length > 1 ? "fusionnées" : "fusionnée"} avec la n°${p.hoteNumero} le ${libelleJourLong(p.date)}`;
}

/** Clé de dédoublonnage : une alerte par fusion (ligne hôte, donc par jour) et par liste d'origines. */
export function cleAlerteFusion(hoteEntryId: string, origines: readonly string[]): string {
  const liste = [...new Set(origines.map(numero).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  return `planning:fusion:${hoteEntryId}:${liste.join("+")}`;
}

/** Rôles qui reçoivent l'alerte de fusion (le manager : son service seulement, lib/alerts/destinataires.ts). Jamais le chauffeur ni le comptable. */
export const ROLES_DESTINATAIRES_FUSION = ["manager", "exploitation", "direction"] as const;
