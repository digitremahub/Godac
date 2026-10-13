/**
 * Listes d'une tournée colis : une tournée peut contenir plusieurs listes
 * (une par donneur d'ordre, par secteur…), livrées l'une après l'autre.
 * Un arrêt sans liste (list_id null) appartient à la liste implicite
 * « Liste principale », toujours en tête : une tournée sans liste se
 * comporte exactement comme avant.
 */
import { longueurParcours, optimiserOrdre, type Point } from "@/lib/colis/optimisation";

export const LISTE_PRINCIPALE = "Liste principale";

export interface Liste {
  id: string;
  name: string;
  position: number;
}

export interface ArretListe {
  id: string;
  list_id?: string | null;
  position: number;
}

export interface Groupe<T> {
  /** null : liste implicite (arrêts sans liste). */
  liste: Liste | null;
  arrets: T[];
}

/**
 * Arrêts regroupés par liste, dans l'ordre des listes puis des positions.
 * La liste implicite n'apparaît que si elle a des arrêts ou s'il n'existe
 * aucune liste ; un arrêt d'une liste inconnue la rejoint.
 */
export function grouperParListe<T extends ArretListe>(arrets: T[], listes: Liste[]): Groupe<T>[] {
  const triees = [...listes].sort((a, b) => a.position - b.position);
  const connues = new Set(triees.map((l) => l.id));
  const parPosition = (a: T, b: T) => a.position - b.position;
  const sansListe = arrets.filter((s) => !s.list_id || !connues.has(s.list_id)).sort(parPosition);
  const groupes: Groupe<T>[] = [];
  if (sansListe.length || !triees.length) groupes.push({ liste: null, arrets: sansListe });
  for (const l of triees) groupes.push({ liste: l, arrets: arrets.filter((s) => s.list_id === l.id).sort(parPosition) });
  return groupes;
}

/** Tous les arrêts dans l'ordre de livraison : liste après liste. */
export function ordonnerParListe<T extends ArretListe>(arrets: T[], listes: Liste[]): T[] {
  return grouperParListe(arrets, listes).flatMap((g) => g.arrets);
}

/** Nom proposé pour une nouvelle liste : « Liste N », sans doublon. */
export function nomNouvelleListe(listes: { name: string }[], implicite = false): string {
  const pris = new Set(listes.map((l) => l.name.trim().toLowerCase()));
  let n = listes.length + (implicite ? 1 : 0) + 1;
  while (pris.has(`liste ${n}`)) n++;
  return `Liste ${n}`;
}

/** Libellé d'un groupe (liste implicite comprise). */
export function nomGroupe(g: { liste: Liste | null }): string {
  return g.liste?.name ?? LISTE_PRINCIPALE;
}

export interface ArretOptimisable extends ArretListe {
  status: string;
  lat: number | string | null;
  lng: number | string | null;
}

/**
 * Ordre de passage d'une tournée à plusieurs listes :
 * - les arrêts déjà faits (livrés / échecs) gardent leur place en tête ;
 * - chaque liste est optimisée à part, dans l'ordre des listes, en
 *   partant du dernier point de la liste précédente (le dépôt, ou la
 *   position du chauffeur, pour la première) ;
 * - le retour au dépôt ne compte qu'après la dernière liste ;
 * - les adresses non localisées passent en fin de leur liste.
 * Renvoie les identifiants dans l'ordre (positions globales 0, 1, 2…) et
 * les distances avant / après (km routiers estimés).
 */
export function sequenceParListes(
  arrets: ArretOptimisable[],
  listes: Liste[],
  depart: Point | null,
  retour: boolean,
): { sequence: string[]; kmAvant: number; kmApres: number; sansGps: number } {
  const pt = (s: ArretOptimisable): Point | null => (s.lat === null || s.lng === null ? null : { lat: Number(s.lat), lng: Number(s.lng) });
  const faits = [...arrets].filter((s) => s.status !== "pending").sort((a, b) => a.position - b.position);
  const groupes = grouperParListe(
    arrets.filter((s) => s.status === "pending"),
    listes,
  ).map((g) => ({ avecGps: g.arrets.filter((s) => pt(s)), sansGps: g.arrets.filter((s) => !pt(s)) }));
  const derniere = groupes.reduce((k, g, i) => (g.avecGps.length ? i : k), -1);

  const sequence = faits.map((s) => s.id);
  const avant: Point[] = [];
  const apres: Point[] = [];
  let courant = depart;
  groupes.forEach((g, i) => {
    const pts = g.avecGps.map((s) => pt(s)!);
    avant.push(...pts);
    // Dernière liste : boucle fermée si elle part du dépôt, sinon arrivée imposée au dépôt.
    const fin = retour && i === derniere;
    const ordre = courant === depart ? optimiserOrdre(courant, pts, fin) : optimiserOrdre(courant, pts, false, fin ? depart : null);
    for (const k of ordre) {
      sequence.push(g.avecGps[k]!.id);
      apres.push(pts[k]!);
    }
    if (ordre.length) courant = pts[ordre[ordre.length - 1]!]!;
    sequence.push(...g.sansGps.map((s) => s.id));
  });

  return {
    sequence,
    kmAvant: longueurParcours(depart, avant, retour),
    kmApres: longueurParcours(depart, apres, retour),
    sansGps: groupes.reduce((n, g) => n + g.sansGps.length, 0),
  };
}

/** Compteurs d'une liste : arrêts, colis, arrêts restants. */
export function compteurs(arrets: { parcel_count: number; status: string }[]) {
  return {
    arrets: arrets.length,
    colis: arrets.reduce((n, s) => n + s.parcel_count, 0),
    restants: arrets.filter((s) => s.status === "pending").length,
  };
}
