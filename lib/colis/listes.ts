/**
 * Listes d'une tournée colis : une tournée peut contenir plusieurs listes
 * (une par donneur d'ordre, par secteur…), livrées l'une après l'autre.
 * Un arrêt sans liste (list_id null) appartient à la liste implicite
 * « Liste principale », toujours en tête : une tournée sans liste se
 * comporte exactement comme avant.
 */
import { FACTEUR_ROUTIER, distanceEstimee, longueurParcours, optimiserOrdre, type Point } from "@/lib/colis/optimisation";
import { minutesTrajet } from "@/lib/colis/estimation";
import { ordonnerAvecHoraires, simulerPassages, type Fenetres, type Passage } from "@/lib/colis/horaires";

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

/** Horaires pris en compte par l'optimisation (lib/colis/horaires.ts). */
export interface OptionsHoraires {
  /** Heure de départ, en minutes depuis minuit (Paris). */
  debut: number;
  /** Fenêtres d'ouverture de l'arrêt ce jour-là (null : pas de contrainte). */
  fenetres: (id: string) => Fenetres;
  minutesParArret?: number;
  /** Distance routière fournie par un moteur de routage ; repli géographique si indisponible. */
  distance?: (a: Point, b: Point) => number;
}

export interface ResultatSequence {
  sequence: string[];
  kmAvant: number;
  kmApres: number;
  sansGps: number;
  /** Avec horaires : heure de passage de chaque arrêt localisé restant. */
  passages: Record<string, Passage>;
  /** Arrêts servis après la fermeture malgré l'optimisation. */
  horsHoraires: string[];
  /** Arrêts fermés ce jour-là (en fin de liste). */
  fermes: string[];
  /** Arrêts qu'on ne peut plus atteindre avant la fermeture (en fin de liste). */
  impossibles: string[];
  /** Heure de fin estimée (retour au dépôt compris), en minutes ; null sans horaires. */
  fin: number | null;
}

/**
 * Ordre de passage d'une tournée à plusieurs listes :
 * - les arrêts déjà faits (livrés / échecs) gardent leur place en tête ;
 * - chaque liste est optimisée à part, dans l'ordre des listes, en
 *   partant du dernier point de la liste précédente (le dépôt, ou la
 *   position du chauffeur, pour la première) ;
 * - le retour au dépôt ne compte qu'après la dernière liste ;
 * - les adresses non localisées passent en fin de leur liste.
 * Avec `horaires`, l'heure avance de liste en liste et chaque liste est
 * ordonnée en respectant les heures d'ouverture (ordonnerAvecHoraires) :
 * fermés et injoignables en fin de liste, avant les non localisés.
 * Renvoie les identifiants dans l'ordre (positions globales 0, 1, 2…) et
 * les distances avant / après (km routiers estimés).
 */
export function sequenceParListes(
  arrets: ArretOptimisable[],
  listes: Liste[],
  depart: Point | null,
  retour: boolean,
  horaires?: OptionsHoraires,
  /** Distance à utiliser sans horaires (matrice routière) ; avec horaires, `horaires.distance`. */
  distanceSansHoraires?: (a: Point, b: Point) => number,
): ResultatSequence {
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
  const passages: Record<string, Passage> = {};
  const fermes: string[] = [];
  const impossibles: string[] = [];
  let courant = depart;
  let heure = horaires?.debut ?? 0;
  const distance = horaires?.distance ?? distanceSansHoraires ?? distanceEstimee;
  // `distance` donne des km routiers (réels ou estimés) ; minutesTrajet()
  // applique lui-même le facteur routier à une distance à vol d'oiseau : on
  // lui passe donc l'équivalent « vol d'oiseau » pour ne pas compter ce
  // facteur deux fois (régression : heures de passage gonflées de 30 %).
  const distanceTemps = (a: Point, b: Point) => distance(a, b) / FACTEUR_ROUTIER;
  groupes.forEach((g, i) => {
    const pts = g.avecGps.map((s) => pt(s)!);
    avant.push(...pts);
    // Dernière liste : boucle fermée si elle part du dépôt, sinon arrivée imposée au dépôt.
    const fin = retour && i === derniere;
    const boucle = courant === depart;
    let ordre: number[];
    if (horaires) {
      const fen = g.avecGps.map((s) => horaires.fenetres(s.id));
      const r = ordonnerAvecHoraires(
        courant,
        pts.map((p, k) => ({ point: p, fenetres: fen[k]! })),
        { debut: heure, retour: boucle ? fin : false, arrivee: boucle ? null : fin ? depart : null, minutesParArret: horaires.minutesParArret, distance: distanceTemps },
      );
      ordre = r.ordre;
      fermes.push(...r.fermes.map((k) => g.avecGps[k]!.id));
      impossibles.push(...r.impossibles.map((k) => g.avecGps[k]!.id));
      const sim = simulerPassages(
        { point: courant, minute: heure },
        ordre.map((k) => ({ point: pts[k]!, fenetres: fen[k]! })),
        horaires.minutesParArret,
        { distance: distanceTemps },
      );
      ordre.forEach((k, j) => (passages[g.avecGps[k]!.id] = sim.passages[j]!));
      heure = sim.fin;
    } else {
      ordre = boucle ? optimiserOrdre(courant, pts, fin, null, distance) : optimiserOrdre(courant, pts, false, fin ? depart : null, distance);
    }
    for (const k of ordre) {
      sequence.push(g.avecGps[k]!.id);
      apres.push(pts[k]!);
    }
    if (ordre.length) courant = pts[ordre[ordre.length - 1]!]!;
    sequence.push(...g.sansGps.map((s) => s.id));
    // Même sans coordonnées, une remise prend en moyenne 3 minutes.
    if (horaires) heure += g.sansGps.length * (horaires.minutesParArret ?? 3);
  });

  const signales = new Set([...fermes, ...impossibles]);
  return {
    sequence,
    kmAvant: longueurParcours(depart, avant, retour, distance),
    kmApres: longueurParcours(depart, apres, retour, distance),
    sansGps: groupes.reduce((n, g) => n + g.sansGps.length, 0),
    passages,
    horsHoraires: Object.entries(passages)
      .filter(([id, p]) => p.statut === "hors" && !signales.has(id))
      .map(([id]) => id),
    fermes,
    impossibles,
    fin: horaires ? heure + (retour && depart && courant && courant !== depart ? minutesTrajet(distanceTemps(courant, depart)) : 0) : null,
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
