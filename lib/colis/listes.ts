/**
 * Listes d'une tournée colis : une tournée peut contenir plusieurs listes
 * (une par donneur d'ordre, par secteur…), livrées l'une après l'autre.
 * Un arrêt sans liste (list_id null) appartient à la liste implicite
 * « Liste principale », toujours en tête : une tournée sans liste se
 * comporte exactement comme avant.
 */
import { FACTEUR_ROUTIER, distanceEstimee, longueurChemin, memePoint, optimiserOrdre, plusProcheVoisin, type Point } from "@/lib/colis/optimisation";
import { minutesTrajet } from "@/lib/colis/estimation";
import { ordonnerAvecHoraires, simulerPassages, type Fenetres, type Passage } from "@/lib/colis/horaires";

export const LISTE_PRINCIPALE = "Liste principale";

export interface Liste {
  id: string;
  name: string;
  position: number;
  /** Liste d'adresses hors tournée (une par commune) ; absent avant la migration 190. */
  is_hors_tournee?: boolean | null;
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
  /** Durée de remise prévue d'un arrêt (fiche client) ; undefined : `minutesParArret`. */
  service?: (id: string) => number | undefined;
  /** Distance routière fournie par un moteur de routage ; repli géographique si indisponible. */
  distance?: (a: Point, b: Point) => number;
  /** « proche » : prochaine adresse la plus proche depuis le départ (recalcul en cours de route) ; défaut « optimal ». */
  strategie?: "optimal" | "proche";
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
 * Extrémités imposées de la tournée (lib/colis/extremites.ts) :
 * - `premierId` : arrêt servi en premier (parmi les arrêts restants) ;
 * - `dernierId` : arrêt servi en dernier ;
 * - `fin` : point où la tournée se termine après le dernier arrêt
 *   (dépôt, adresse choisie, départ) ; null = pas de retour imposé. Absent :
 *   le paramètre `retour` de sequenceParListes (retour au départ) s'applique.
 */
export interface ExtremitesSequence {
  premierId?: string | null;
  dernierId?: string | null;
  fin?: Point | null;
  /** « proche » : enchaîner la prochaine adresse la plus proche (sans horaires). */
  strategie?: "optimal" | "proche";
}

/**
 * Ordre de passage d'une tournée à plusieurs listes :
 * - les arrêts déjà faits (livrés / échecs) gardent leur place en tête ;
 * - chaque liste est optimisée à part, dans l'ordre des listes, en
 *   partant du dernier point de la liste précédente (le dépôt, ou la
 *   position du chauffeur, pour la première) ;
 * - le retour (dépôt, adresse d'arrivée) ne compte qu'après la dernière liste ;
 * - les adresses non localisées passent en fin de leur liste ;
 * - avec `extremites`, le premier arrêt choisi ouvre la tournée et le
 *   dernier la ferme : l'ordre des autres est optimisé entre les deux
 *   (chemin à extrémités fixes). Leurs listes doivent être en tête / en
 *   queue (voir contraintesListes).
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
  extremites?: ExtremitesSequence,
): ResultatSequence {
  const pt = (s: ArretOptimisable): Point | null => (s.lat === null || s.lng === null ? null : { lat: Number(s.lat), lng: Number(s.lng) });
  const faits = [...arrets].filter((s) => s.status !== "pending").sort((a, b) => a.position - b.position);
  const restants = arrets.filter((s) => s.status === "pending");
  const premier = extremites?.premierId ? restants.find((s) => s.id === extremites.premierId && pt(s)) : undefined;
  const dernierBrut = extremites?.dernierId ? restants.find((s) => s.id === extremites.dernierId && pt(s)) : undefined;
  // Le même arrêt ne peut pas être premier et dernier (sauf s'il est seul : rien à ordonner).
  const dernier = dernierBrut && dernierBrut !== premier ? dernierBrut : undefined;
  const fixe = (s: ArretOptimisable) => s === premier || s === dernier;
  const groupes = grouperParListe(restants, listes).map((g) => ({
    avecGps: g.arrets.filter((s) => pt(s) && !fixe(s)),
    sansGps: g.arrets.filter((s) => !pt(s)),
    premier: g.arrets.find((s) => s === premier),
    dernier: g.arrets.find((s) => s === dernier),
  }));
  const derniere = groupes.reduce((k, g, i) => (g.avecGps.length || g.dernier ? i : k), -1);
  // Point où la tournée se termine après le dernier arrêt.
  const strategie = horaires?.strategie ?? extremites?.strategie ?? "proche";
  const cibleFin = extremites?.fin !== undefined ? extremites.fin : retour ? depart : null;

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
  // Départ = premier arrêt : il ouvre le chemin, sans trajet avant lui.
  const departEstPremier = Boolean(premier && memePoint(depart, pt(premier)));
  // Dernier arrêt = arrivée : il ferme le chemin, sans trajet après lui.
  const finEstDernier = Boolean(dernier && memePoint(cibleFin, pt(dernier)));
  // Avant optimisation : ordre actuel des arrêts (hors extrémités qui sont le départ ou l'arrivée).
  for (const g of groupes) {
    for (const s of [...(g.premier ? [g.premier] : []), ...g.avecGps, ...(g.dernier ? [g.dernier] : [])]) {
      if ((s === premier && departEstPremier) || (s === dernier && finEstDernier)) continue;
      avant.push(pt(s)!);
    }
  }
  const serviceDe = (id: string): { service?: number } => {
    const v = horaires?.service?.(id);
    return v === undefined ? {} : { service: v };
  };
  const servirFixe = (s: ArretOptimisable, p: Point) => {
    sequence.push(s.id);
    if (!((s === premier && departEstPremier) || (s === dernier && finEstDernier))) apres.push(p);
    if (horaires) {
      const sim = simulerPassages({ point: courant, minute: heure }, [{ point: p, fenetres: horaires.fenetres(s.id), ...serviceDe(s.id) }], horaires.minutesParArret, { distance: distanceTemps });
      passages[s.id] = sim.passages[0]!;
      heure = sim.fin;
    }
    courant = p;
  };

  groupes.forEach((g, i) => {
    // Premier arrêt de la tournée : servi avant l'optimisation de sa liste.
    if (g.premier) servirFixe(g.premier, pt(g.premier)!);
    const pts = g.avecGps.map((s) => pt(s)!);
    // Cible de cette liste : l'arrêt imposé en dernier, sinon le point final après la dernière liste.
    const cible = g.dernier ? pt(g.dernier)! : i === derniere ? cibleFin : null;
    const boucle = courant === depart || memePoint(courant, depart);
    // Revenir exactement au point de départ referme la boucle ; sinon arrivée fixe.
    const ferme = Boolean(cible && boucle && memePoint(cible, depart));
    const arrivee = cible && !ferme ? cible : null;
    let ordre: number[];
    if (horaires) {
      const fen = g.avecGps.map((s) => horaires.fenetres(s.id));
      const r = ordonnerAvecHoraires(
        courant,
        pts.map((p, k) => ({ point: p, fenetres: fen[k]!, ...serviceDe(g.avecGps[k]!.id) })),
        { debut: heure, retour: ferme, arrivee, minutesParArret: horaires.minutesParArret, distance: distanceTemps, strategie: horaires.strategie },
      );
      ordre = r.ordre;
      fermes.push(...r.fermes.map((k) => g.avecGps[k]!.id));
      impossibles.push(...r.impossibles.map((k) => g.avecGps[k]!.id));
      const sim = simulerPassages(
        { point: courant, minute: heure },
        ordre.map((k) => ({ point: pts[k]!, fenetres: fen[k]!, ...serviceDe(g.avecGps[k]!.id) })),
        horaires.minutesParArret,
        { distance: distanceTemps },
      );
      ordre.forEach((k, j) => (passages[g.avecGps[k]!.id] = sim.passages[j]!));
      heure = sim.fin;
    } else {
      ordre = strategie === "proche" ? plusProcheVoisin(courant, pts, distance) : optimiserOrdre(courant, pts, ferme, arrivee, distance);
    }
    for (const k of ordre) {
      sequence.push(g.avecGps[k]!.id);
      apres.push(pts[k]!);
    }
    if (ordre.length) courant = pts[ordre[ordre.length - 1]!]!;
    sequence.push(...g.sansGps.map((s) => s.id));
    // Dernier arrêt de la tournée : servi après tous les autres de sa liste.
    if (g.dernier) servirFixe(g.dernier, pt(g.dernier)!);
  });

  const signales = new Set([...fermes, ...impossibles]);
  const retourMin = cibleFin && courant && !memePoint(courant, cibleFin) ? minutesTrajet(distanceTemps(courant, cibleFin)) : 0;
  return {
    sequence,
    kmAvant: longueurChemin(depart, avant, cibleFin, distance),
    kmApres: longueurChemin(depart, apres, cibleFin, distance),
    sansGps: groupes.reduce((n, g) => n + g.sansGps.length, 0),
    passages,
    horsHoraires: Object.entries(passages)
      .filter(([id, p]) => p.statut === "hors" && !signales.has(id))
      .map(([id]) => id),
    fermes,
    impossibles,
    fin: horaires ? heure + retourMin : null,
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
