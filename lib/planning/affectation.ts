/**
 * Écran d'affectation glisser-déposer (vues Jour, Semaine, Mois) : logique
 * pure partagée entre l'écran (components/planning/Affectations.tsx) et
 * les routes (app/api/planning/affecter, duplicate-week…). Aucun accès
 * réseau ni base : testé dans lib/planning/__tests__/affectation.test.ts.
 *
 * Une « ligne » est une tournée (service + numéro). Une « case » est une
 * tournée un jour donné : remplie (chauffeur), à remplacer (affectation
 * sans chauffeur), prévue mais vide, ou simplement vide (jour où la
 * tournée ne roule pas d'habitude).
 */
import { addDays, monthCalendarDays } from "@/lib/planning/dates";
import { heureDe, jourDe, rangJour, type AffectationPlanning, type CongePlanning, type ModelePlanning } from "@/lib/planning/semaine";
import { estFermeeNonAffectee } from "@/lib/planning/ouverture";

// ---------------------------------------------------------------------------
// Absences : congés validés, arrêts de travail.
// ---------------------------------------------------------------------------

/** Arrêt de travail (work_stoppages, lib/planning/absences.ts › lireAbsences). */
export interface ArretPlanning {
  user_id: string;
  start_date: string;
  end_date: string;
  /** stoppage_type : maladie, at_mp, trajet, maternite, paternite, sans_solde. */
  motif?: string | null;
}

/** Libellé court du motif d'un arrêt. */
export const MOTIFS_ARRET: Record<string, string> = {
  maladie: "Arrêt maladie",
  at_mp: "Accident du travail",
  trajet: "Accident de trajet",
  maternite: "Congé maternité",
  paternite: "Congé paternité",
  sans_solde: "Congé sans solde",
};

export type Indisponibilite =
  /** Congé validé : non plaçable. */
  | { type: "conge"; fin: string }
  /** Arrêt de travail : non plaçable. */
  | { type: "arret"; fin: string; motif: string | null }
  /** Congé demandé, pas encore répondu : plaçable, signalé. */
  | { type: "conge_demande"; fin: string };

/**
 * Indisponibilité d'un chauffeur un jour donné. Un arrêt l'emporte sur un
 * congé (il bloque quoi qu'il arrive), un congé validé sur une demande.
 */
export function indisponibilite(driverId: string, date: string, conges: readonly CongePlanning[], arrets: readonly ArretPlanning[] = []): Indisponibilite | null {
  const arret = arrets.filter((a) => a.user_id === driverId && date >= a.start_date && date <= a.end_date).sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
  if (arret) return { type: "arret", fin: arret.end_date, motif: arret.motif ?? null };
  const du = conges.filter((c) => c.driver_id === driverId && date >= c.start_date && date <= c.end_date);
  const valide = du.filter((c) => c.status === "approved").sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
  if (valide) return { type: "conge", fin: valide.end_date };
  const demande = du.filter((c) => c.status === "pending").sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
  if (demande) return { type: "conge_demande", fin: demande.end_date };
  return null;
}

/** Absent = congé validé ou arrêt : on ne le place pas (la case reste « à remplacer »). */
export function estAbsent(driverId: string, date: string, conges: readonly CongePlanning[], arrets: readonly ArretPlanning[] = []): boolean {
  const i = indisponibilite(driverId, date, conges, arrets);
  return i !== null && i.type !== "conge_demande";
}

/** « Congé jusqu'au 27/10 », « Arrêt maladie jusqu'au 02/11 », « Congé demandé (jusqu'au …) ». */
export function libelleIndisponibilite(i: Indisponibilite): string {
  const fin = `${i.fin.slice(8, 10)}/${i.fin.slice(5, 7)}`;
  if (i.type === "conge") return `Congé jusqu'au ${fin}`;
  if (i.type === "arret") return `${(i.motif && MOTIFS_ARRET[i.motif]) || "Arrêt de travail"} jusqu'au ${fin}`;
  return `Congé demandé (jusqu'au ${fin})`;
}

// ---------------------------------------------------------------------------
// Lignes : une par tournée.
// ---------------------------------------------------------------------------

export interface RoutePlanning {
  id: string;
  tourNumber: string;
  serviceId: string | null;
  villages?: string[];
  renfort?: boolean;
}

export interface LigneTournee {
  /** service|numéro */
  cle: string;
  serviceId: string;
  tourNumber: string;
  routeId: string | null;
  /** Heure de départ habituelle (modèle, sinon affectation la plus fréquente, sinon 07:00). */
  heure: string;
  /**
   * Jours où elle roule d'habitude (0 = dimanche … 6 = samedi, comme les
   * modèles) : le modèle, sinon lundi → vendredi, plus tout jour (samedi,
   * dimanche…) où elle a des affectations dans la période chargée.
   */
  joursPrevus: number[];
  villages: string[];
  renfort: boolean;
}

/** Sans modèle, une tournée roule du lundi au vendredi (comme les modèles par défaut). */
export const JOURS_PREVUS_PAR_DEFAUT = [1, 2, 3, 4, 5];

export const cleLigne = (serviceId: string, tourNumber: string) => `${serviceId}|${tourNumber}`;

/** Comparaison de numéros de tournée « naturelle » : T2 avant T10. */
export function comparerNumeros(a: string, b: string): number {
  return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
}

/**
 * Lignes de la grille : tournées-modèles des services affichés, plus tout
 * numéro présent dans les affectations de la période (tournée saisie à la
 * main). Une tournée-modèle sans service va au service par défaut (filtre
 * choisi, ou service unique) ; sinon elle n'apparaît qu'avec ses affectations.
 */
export function lignesTournees(params: {
  routes: readonly RoutePlanning[];
  modeles: readonly ModelePlanning[];
  affectations: readonly AffectationPlanning[];
  serviceIds: readonly string[];
  serviceParDefaut?: string | null;
}): LigneTournee[] {
  const services = new Set(params.serviceIds);
  const lignes = new Map<string, LigneTournee>();
  const heures = new Map<string, Map<string, number>>();
  const joursVus = new Map<string, Set<number>>();

  function ajouter(serviceId: string, tourNumber: string, route: RoutePlanning | null) {
    const cle = cleLigne(serviceId, tourNumber);
    const existante = lignes.get(cle);
    if (existante) {
      if (route && !existante.routeId) Object.assign(existante, { routeId: route.id, villages: route.villages ?? [], renfort: Boolean(route.renfort) });
      return;
    }
    lignes.set(cle, { cle, serviceId, tourNumber, routeId: route?.id ?? null, heure: "07:00", joursPrevus: JOURS_PREVUS_PAR_DEFAUT, villages: route?.villages ?? [], renfort: Boolean(route?.renfort) });
  }

  for (const r of params.routes) {
    const service = r.serviceId ?? params.serviceParDefaut ?? (params.serviceIds.length === 1 ? params.serviceIds[0]! : null);
    if (service && services.has(service)) ajouter(service, r.tourNumber, r);
  }
  for (const a of params.affectations) {
    if (!services.has(a.service_id) || a.status === "presence" || a.tour_number.startsWith("PRESENCE-")) continue;
    const route = params.routes.find((r) => r.tourNumber === a.tour_number && (r.serviceId === a.service_id || !r.serviceId)) ?? null;
    ajouter(a.service_id, a.tour_number, route);
    const parHeure = heures.get(cleLigne(a.service_id, a.tour_number)) ?? new Map<string, number>();
    const h = heureDe(a.start_at);
    parHeure.set(h, (parHeure.get(h) ?? 0) + 1);
    heures.set(cleLigne(a.service_id, a.tour_number), parHeure);
    if (a.status !== "cancelled") {
      const vus = joursVus.get(cleLigne(a.service_id, a.tour_number)) ?? new Set<number>();
      vus.add(new Date(`${jourDe(a.start_at)}T12:00:00Z`).getUTCDay());
      joursVus.set(cleLigne(a.service_id, a.tour_number), vus);
    }
  }

  for (const ligne of lignes.values()) {
    const modeles = params.modeles.filter((m) => m.service_id === ligne.serviceId && m.tour_number === ligne.tourNumber);
    const vus = [...(joursVus.get(ligne.cle) ?? [])];
    if (modeles.length) {
      // Le modèle, plus les jours où la tournée a réellement roulé (samedi compris).
      ligne.joursPrevus = [...new Set([...modeles.flatMap((m) => m.weekdays), ...vus])].sort((a, b) => a - b);
      ligne.heure = modeles[0]!.departure_time.slice(0, 5);
      continue;
    }
    // Sans modèle : lundi → vendredi, plus samedi et dimanche s'ils servent.
    ligne.joursPrevus = [...new Set([...JOURS_PREVUS_PAR_DEFAUT, ...vus.filter((j) => j === 6 || j === 0)])].sort((a, b) => a - b);
    const parHeure = heures.get(ligne.cle);
    if (parHeure?.size) ligne.heure = [...parHeure.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  }

  return [...lignes.values()].sort((a, b) => a.heure.localeCompare(b.heure) || comparerNumeros(a.tourNumber, b.tourNumber));
}

/** La tournée roule-t-elle d'habitude ce jour-là ? */
export function estJourPrevu(ligne: Pick<LigneTournee, "joursPrevus">, date: string): boolean {
  return ligne.joursPrevus.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
}

// ---------------------------------------------------------------------------
// Cases.
// ---------------------------------------------------------------------------

export const cleCaseTournee = (cle: string, date: string) => `${cle}@${date}`;

/** Affectations (hors annulées et présences) rangées par case tournée × jour, triées par heure. */
export function affectationsParTournee<T extends AffectationPlanning>(affectations: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const a of affectations) {
    if (a.status === "cancelled" || a.status === "presence") continue;
    const k = cleCaseTournee(cleLigne(a.service_id, a.tour_number), jourDe(a.start_at));
    const liste = m.get(k) ?? [];
    liste.push(a);
    m.set(k, liste);
  }
  for (const liste of m.values()) liste.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return m;
}

export type EtatCase = "remplie" | "a_remplacer" | "vide_prevue" | "vide" | "fermee" | "fusionnee";

/**
 * Cases verrouillées par une fusion (lib/planning/fusion-verrou.ts ›
 * tourneesVerrouilleesParFusion), indexées par cleCaseTournee(ligne.cle, jour).
 * Seule la présence de la clé compte ici.
 */
export type VerrousCases = ReadonlyMap<string, unknown>;

/** La case (tournée × jour) est-elle verrouillée par une fusion ? */
export const estCaseVerrouillee = (verrous: VerrousCases | undefined, ligne: Pick<LigneTournee, "cle">, date: string): boolean => Boolean(verrous?.has(cleCaseTournee(ligne.cle, date)));

/**
 * État d'une case : remplie si toutes ses affectations ont un chauffeur,
 * « à remplacer » si l'une n'en a pas, « vide prévue » si la tournée roule
 * ce jour-là sans affectation (un trou), « vide » sinon. « Fermée » : la
 * tournée a été fermée sans chauffeur (elle ne roule pas ce jour-là) ; ce
 * n'est pas un trou. Une fermeture n'efface pas une autre affectation de la
 * case (combiné) : seules les lignes restantes décident.
 * « Fusionnée » (`fusionnee`) : la tournée est une tournée d'origine d'une
 * fusion ce jour-là. Case verrouillée : ni trou, ni « sans chauffeur », ni
 * affectable, quoi qu'elle contienne (une affectation qui s'y trouve est un
 * doublon, signalé à part : lib/planning/fusion-verrou.ts).
 */
export function etatCase(entrees: readonly Pick<AffectationPlanning, "driver_id" | "tour_open">[], prevue: boolean, fusionnee = false): EtatCase {
  if (fusionnee) return "fusionnee";
  const actives = entrees.filter((e) => !estFermeeNonAffectee(e));
  if (actives.length) return actives.some((e) => !e.driver_id) ? "a_remplacer" : "remplie";
  if (entrees.length) return "fermee";
  return prevue ? "vide_prevue" : "vide";
}

/** Une case à pourvoir : « à remplacer » ou prévue et vide. */
export const estUnTrou = (etat: EtatCase) => etat === "a_remplacer" || etat === "vide_prevue";

/**
 * Jours d'une ligne où la tournée est sans chauffeur et peut être fermée
 * (« Fermer les jours sans chauffeur de cette ligne ») : trous sans aucun
 * chauffeur placé, pas avant `depuis`.
 */
export function joursSansChauffeur<T extends AffectationPlanning>(ligne: LigneTournee, jours: readonly string[], parCase: Map<string, T[]>, depuis?: string, verrous?: VerrousCases): string[] {
  return jours.filter((d) => {
    if (depuis && d < depuis) return false;
    const entrees = parCase.get(cleCaseTournee(ligne.cle, d)) ?? [];
    return estUnTrou(etatCase(entrees, estJourPrevu(ligne, d), estCaseVerrouillee(verrous, ligne, d))) && entrees.every((e) => !e.driver_id);
  });
}

/** Nombre de trous par jour (ligne de synthèse du mois, compteurs du jour). */
export function trousParJour<T extends AffectationPlanning>(lignes: readonly LigneTournee[], jours: readonly string[], parCase: Map<string, T[]>, verrous?: VerrousCases): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of jours) {
    out[d] = lignes.filter((l) => estUnTrou(etatCase(parCase.get(cleCaseTournee(l.cle, d)) ?? [], estJourPrevu(l, d), estCaseVerrouillee(verrous, l, d)))).length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Étirer une case vers la droite, « toute la semaine ».
// ---------------------------------------------------------------------------

/**
 * Étirer une case remplie jusqu'à une autre case de la même ligne : les
 * jours affichés strictement après le jour source, jusqu'au jour visé
 * inclus (vers la gauche : rien). Les jours non affichés (dimanche masqué)
 * sont sautés.
 */
export function joursEtires(source: string, jusqua: string, joursAffiches: readonly string[]): string[] {
  if (jusqua <= source) return [];
  return joursAffiches.filter((d) => d > source && d <= jusqua);
}

/**
 * « Toute la semaine » sur une tournée : les jours affichés où elle roule
 * d'habitude ; si aucun ne l'est (tournée occasionnelle), tous les jours
 * affichés du lundi au vendredi.
 */
export function joursDeLaLigne(ligne: Pick<LigneTournee, "joursPrevus">, joursAffiches: readonly string[]): string[] {
  const prevus = joursAffiches.filter((d) => estJourPrevu(ligne, d));
  return prevus.length ? prevus : joursAffiches.filter((d) => rangJour(d) < 5);
}

/** Les jours que la grille affiche : lundi → samedi, dimanche s'il sert (affectation ou modèle). */
export function joursAffichesSemaine(lundi: string, dimancheUtilise: boolean): string[] {
  return Array.from({ length: dimancheUtilise ? 7 : 6 }, (_, i) => addDays(lundi, i));
}

/** Le dimanche sert-il dans la période (une affectation ou un modèle qui roule le dimanche) ? */
export function dimancheUtilise(affectations: readonly AffectationPlanning[], lignes: readonly LigneTournee[]): boolean {
  return lignes.some((l) => l.joursPrevus.includes(0)) || affectations.some((a) => a.status !== "cancelled" && rangJour(jourDe(a.start_at)) === 6);
}

/** Rangs (0 = lundi … 6 = dimanche) des jours habituels d'une tournée (joursPrevus : 0 = dimanche … 6 = samedi). */
export function rangsDesJoursPrevus(joursPrevus: readonly number[]): number[] {
  return [...new Set(joursPrevus.map((j) => (j + 6) % 7))].sort((a, b) => a - b);
}

/** Raccourci « Lun → Sam » de la feuille « Affecter à… ». */
export const RANGS_LUNDI_SAMEDI = [0, 1, 2, 3, 4, 5];

/**
 * Jours à remplir pour « toute la semaine / tout le mois » avec des jours
 * choisis (rangs 0 = lundi … 6 = dimanche) : les jours donnés dont le rang
 * est coché et qui ne sont pas passés (`depuis`, inclus).
 */
export function joursChoisis(jours: readonly string[], rangs: readonly number[], depuis?: string): string[] {
  const coches = new Set(rangs);
  return jours.filter((d) => coches.has(rangJour(d)) && (!depuis || d >= depuis));
}

/** Les jours d'un mois « AAAA-MM », le dimanche seulement s'il est demandé. */
export function joursDuMois(mois: string, avecDimanche: boolean): string[] {
  const jours: string[] = [];
  const premier = `${mois}-01`;
  for (let d = premier; d.slice(0, 7) === mois; d = addDays(d, 1)) if (avecDimanche || rangJour(d) !== 6) jours.push(d);
  return jours;
}

// ---------------------------------------------------------------------------
// Calendrier du mois (téléphone) : 7 colonnes lundi → dimanche.
// ---------------------------------------------------------------------------

export type CouvertureJour = "hors_mois" | "aucune" | "trous" | "complet";

export interface CelluleMois {
  date: string;
  dansMois: boolean;
  /** Tournées qui comptent ce jour-là (prévues ou déjà placées). */
  tournees: number;
  /** Cases à pourvoir (à remplacer ou prévues et vides). */
  trous: number;
  /** Hors du mois : pas de données chargées, donc pas d'indicateur. */
  couverture: CouvertureJour;
}

/**
 * Calendrier d'un mois : une liste de semaines (lundi → dimanche, jours des
 * mois voisins compris pour compléter), chaque jour avec son nombre de
 * tournées et de trous. Les jours hors du mois n'ont pas de données
 * (seul le mois est chargé) : couverture « hors_mois », sans compteur.
 */
export function calendrierMois<T extends AffectationPlanning>(mois: string, lignes: readonly LigneTournee[], parCase: Map<string, T[]>, verrous?: VerrousCases): { lundi: string; jours: CelluleMois[] }[] {
  const semaines: { lundi: string; jours: CelluleMois[] }[] = [];
  for (const date of monthCalendarDays(mois)) {
    const dansMois = date.slice(0, 7) === mois;
    let tournees = 0;
    let trous = 0;
    if (dansMois) {
      for (const l of lignes) {
        const etat = etatCase(parCase.get(cleCaseTournee(l.cle, date)) ?? [], estJourPrevu(l, date), estCaseVerrouillee(verrous, l, date));
        if (etat !== "vide" && etat !== "fermee" && etat !== "fusionnee") tournees++;
        if (estUnTrou(etat)) trous++;
      }
    }
    const couverture: CouvertureJour = !dansMois ? "hors_mois" : tournees === 0 ? "aucune" : trous > 0 ? "trous" : "complet";
    if (rangJour(date) === 0) semaines.push({ lundi: date, jours: [] });
    semaines.at(-1)!.jours.push({ date, dansMois, tournees, trous, couverture });
  }
  return semaines;
}

/** Jour ouvert par défaut en vue Semaine (téléphone) : aujourd'hui s'il est dans la semaine, sinon le premier jour avec un trou, sinon le premier. */
export function jourParDefaut(jours: readonly string[], aujourdhui: string, trous: Record<string, number>): string {
  if (jours.includes(aujourdhui)) return aujourdhui;
  return jours.find((d) => (trous[d] ?? 0) > 0) ?? jours[0]!;
}

// ---------------------------------------------------------------------------
// Chauffeurs : pastilles, initiales, résumé.
// ---------------------------------------------------------------------------

/**
 * Palette des pastilles (fond, texte), lisible en clair comme en sombre :
 * couleurs moyennes avec texte foncé ou blanc selon leur luminance.
 */
export const PALETTE_CHAUFFEURS: readonly { fond: string; texte: string }[] = [
  { fond: "#1BE4C1", texte: "#0A0F1E" },
  { fond: "#FF8A5B", texte: "#0A0F1E" },
  { fond: "#7C9CFF", texte: "#0A0F1E" },
  { fond: "#F5C842", texte: "#0A0F1E" },
  { fond: "#C084FC", texte: "#0A0F1E" },
  { fond: "#34D399", texte: "#0A0F1E" },
  { fond: "#F472B6", texte: "#0A0F1E" },
  { fond: "#38BDF8", texte: "#0A0F1E" },
  { fond: "#A3E635", texte: "#0A0F1E" },
  { fond: "#2563EB", texte: "#FFFFFF" },
  { fond: "#B45309", texte: "#FFFFFF" },
  { fond: "#0F766E", texte: "#FFFFFF" },
];

/** Couleur stable d'un chauffeur (même identifiant → même couleur, partout, à chaque chargement). */
export function couleurChauffeur(id: string): { fond: string; texte: string } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE_CHAUFFEURS[(h >>> 0) % PALETTE_CHAUFFEURS.length]!;
}

/** « Karim Mansouri » → « KM » ; « Laura » → « LA ». */
export function initiales(nom: string): string {
  const mots = nom.trim().split(/[\s-]+/).filter(Boolean);
  if (!mots.length) return "?";
  if (mots.length === 1) return mots[0]!.slice(0, 2).toUpperCase();
  return `${mots[0]![0]}${mots[mots.length - 1]![0]}`.toUpperCase();
}

/** « Karim Mansouri » → « Karim M. » */
export function nomCourt(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length < 2) return nom.trim();
  return `${mots[0]} ${mots[mots.length - 1]![0]!.toUpperCase()}.`;
}

/** Nombre de jours (distincts) où chaque chauffeur est placé dans la période. */
export function joursPlacesParChauffeur(affectations: readonly AffectationPlanning[], jours: readonly string[]): Map<string, number> {
  const visibles = new Set(jours);
  const parChauffeur = new Map<string, Set<string>>();
  for (const a of affectations) {
    if (!a.driver_id || a.status === "cancelled" || a.status === "presence") continue;
    const d = jourDe(a.start_at);
    if (!visibles.has(d)) continue;
    const s = parChauffeur.get(a.driver_id) ?? new Set<string>();
    s.add(d);
    parChauffeur.set(a.driver_id, s);
  }
  return new Map([...parChauffeur.entries()].map(([id, s]) => [id, s.size]));
}

export type EtatChauffeur = "disponible" | "pris" | "absent";

/** État d'un chauffeur pour un jour : absent (congé validé, arrêt), pris (déjà une tournée), disponible. */
export function etatChauffeurDuJour(
  driverId: string,
  date: string,
  affectations: readonly AffectationPlanning[],
  conges: readonly CongePlanning[],
  arrets: readonly ArretPlanning[] = [],
): { etat: EtatChauffeur; tournees: string[]; indispo: Indisponibilite | null } {
  const indispo = indisponibilite(driverId, date, conges, arrets);
  const tournees = affectations
    .filter((a) => a.driver_id === driverId && a.status !== "cancelled" && a.status !== "presence" && jourDe(a.start_at) === date)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .map((a) => a.tour_number);
  if (indispo && indispo.type !== "conge_demande") return { etat: "absent", tournees, indispo };
  return { etat: tournees.length ? "pris" : "disponible", tournees, indispo };
}

/** Le chauffeur a-t-il déjà conduit cette tournée (historique) ? */
export function connaitTournee(driverId: string, tourNumber: string, historique: readonly Pick<AffectationPlanning, "driver_id" | "tour_number">[]): boolean {
  return historique.some((a) => a.driver_id === driverId && a.tour_number === tourNumber);
}

// ---------------------------------------------------------------------------
// Compteurs de la vue Jour.
// ---------------------------------------------------------------------------

export interface CompteursJour {
  tournees: number;
  affectees: number;
  sansChauffeur: number;
  /** Tournées fermées sans chauffeur ce jour-là : hors des autres compteurs. */
  fermees: number;
  /** Tournées d'origine d'une fusion ce jour-là : verrouillées, hors des autres compteurs. Absent quand il n'y en a aucune. */
  fusionnees?: number;
  disponibles: number;
  absents: number;
}

export function compteursDuJour<T extends AffectationPlanning>(params: {
  date: string;
  lignes: readonly LigneTournee[];
  parCase: Map<string, T[]>;
  chauffeurs: readonly { id: string }[];
  affectations: readonly AffectationPlanning[];
  conges: readonly CongePlanning[];
  arrets?: readonly ArretPlanning[];
  verrous?: VerrousCases;
}): CompteursJour {
  const { date } = params;
  const etats = params.lignes
    .map((l) => etatCase(params.parCase.get(cleCaseTournee(l.cle, date)) ?? [], estJourPrevu(l, date), estCaseVerrouillee(params.verrous, l, date)))
    .filter((e) => e !== "vide");
  const chauffeurs = params.chauffeurs.map((c) => etatChauffeurDuJour(c.id, date, params.affectations, params.conges, params.arrets ?? []).etat);
  return {
    tournees: etats.filter((e) => e !== "fermee" && e !== "fusionnee").length,
    fermees: etats.filter((e) => e === "fermee").length,
    ...(etats.includes("fusionnee") ? { fusionnees: etats.filter((e) => e === "fusionnee").length } : {}),
    affectees: etats.filter((e) => e === "remplie").length,
    sansChauffeur: etats.filter(estUnTrou).length,
    disponibles: chauffeurs.filter((e) => e === "disponible").length,
    absents: chauffeurs.filter((e) => e === "absent").length,
  };
}

// ---------------------------------------------------------------------------
// Glisser d'une tournée à l'autre : déplacer ou échanger (vue Jour).
// ---------------------------------------------------------------------------

export type EtapeAffectation =
  /** Enlever le chauffeur d'une affectation (elle reste, « à remplacer »). */
  | { type: "retirer"; entreeId: string }
  /** Placer un chauffeur sur une case (affectation existante mise à jour, ou créée). */
  | { type: "placer"; cle: string; date: string; driverId: string };

/**
 * Glisser le chauffeur de la case A vers la case B, le même jour :
 * - B vide : il quitte A (qui reste « à remplacer ») et prend B ;
 * - B occupée par Y : échange, Y prend A.
 * On retire d'abord : le chauffeur qui change de tournée n'a ainsi pas
 * « une 2ᵉ tournée » le temps de l'opération (pas de question inutile).
 */
export function etapesDeplacement(params: {
  source: { entreeId: string; driverId: string; cle: string; date: string };
  cible: { cle: string; date: string; entreeId: string | null; driverId: string | null };
}): EtapeAffectation[] {
  const { source, cible } = params;
  if (source.cle === cible.cle && source.date === cible.date) return [];
  if (cible.driverId === source.driverId) return [{ type: "retirer", entreeId: source.entreeId }];
  const etapes: EtapeAffectation[] = [{ type: "retirer", entreeId: source.entreeId }];
  if (cible.entreeId && cible.driverId) etapes.push({ type: "retirer", entreeId: cible.entreeId });
  etapes.push({ type: "placer", cle: cible.cle, date: cible.date, driverId: source.driverId });
  if (cible.driverId) etapes.push({ type: "placer", cle: source.cle, date: source.date, driverId: cible.driverId });
  return etapes;
}

// ---------------------------------------------------------------------------
// Placer un chauffeur sur des jours (route POST /api/planning/affecter).
// ---------------------------------------------------------------------------

export type DecisionJour =
  /** Créer l'affectation avec ce chauffeur. */
  | { type: "creer"; date: string; startAt: string; driverId: string | null }
  /** Mettre ce chauffeur sur l'affectation existante. */
  | { type: "changer"; date: string; entreeId: string; ancienChauffeur: string | null; /** Nouvelle heure (heure choisie à l'affectation, différente de l'actuelle). */ startAt?: string }
  /** Rien à faire : déjà ce chauffeur, tournée démarrée, ou chauffeur absent avec une case déjà tenue. */
  | { type: "rien"; date: string; raison: "deja" | "figee" | "absent" };

/**
 * Pour chaque jour demandé : créer, changer de chauffeur ou ne rien faire.
 * Chauffeur absent ce jour-là (congé validé, arrêt) : il n'est PAS placé ;
 * une case vide devient une affectation « à remplacer » (sans chauffeur),
 * une case déjà tenue par quelqu'un d'autre reste telle quelle.
 */
export function decisionsAffectation(params: {
  dates: readonly string[];
  driverId: string | null;
  heure: string;
  /** L'heure a été choisie à la main : une affectation existante qui en a une autre la prend aussi. */
  imposerHeure?: boolean;
  existantes: readonly AffectationPlanning[];
  absent: (driverId: string, date: string) => boolean;
  versUtc: (date: string, heure: string) => string;
}): DecisionJour[] {
  const out: DecisionJour[] = [];
  for (const date of [...new Set(params.dates)].sort()) {
    // Une tournée fermée est figée comme une tournée démarrée (lib/planning/ouverture.ts).
    const duJour = params.existantes
      .filter((e) => jourDe(e.start_at) === date && e.status !== "cancelled")
      .map((e) => (e.tour_open === false && e.status === "planned" ? { ...e, status: "fermee" } : e))
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const absent = params.driverId !== null && params.absent(params.driverId, date);
    if (!duJour.length) {
      out.push({ type: "creer", date, startAt: params.versUtc(date, params.heure), driverId: absent ? null : params.driverId });
      continue;
    }
    if (params.driverId && duJour.some((e) => e.driver_id === params.driverId)) {
      out.push({ type: "rien", date, raison: "deja" });
      continue;
    }
    // La première affectation encore prévue de la case : sans chauffeur d'abord.
    const cible = duJour.find((e) => e.status === "planned" && !e.driver_id) ?? duJour.find((e) => e.status === "planned");
    if (!cible) {
      out.push({ type: "rien", date, raison: "figee" });
      continue;
    }
    if (absent) {
      out.push({ type: "rien", date, raison: "absent" });
      continue;
    }
    const nouvelleHeure = params.imposerHeure && heureDe(cible.start_at) !== params.heure;
    out.push({ type: "changer", date, entreeId: cible.id, ancienChauffeur: cible.driver_id, ...(nouvelleHeure ? { startAt: params.versUtc(date, params.heure) } : {}) });
  }
  return out;
}

/** « 4 jours placés, vendredi à remplacer (congé) » */
export function texteAffectation(r: { places: number; absents: string[]; figees: number; deja: number; fermees?: number; fusionnees?: number }, libelleJour: (d: string) => string): string {
  const parts: string[] = [];
  if (r.places) parts.push(`${r.places} jour${r.places > 1 ? "s" : ""} placé${r.places > 1 ? "s" : ""}`);
  if (r.deja) parts.push(`${r.deja} déjà en place`);
  if (r.absents.length) parts.push(`${r.absents.map(libelleJour).join(", ")} à remplacer (absent)`);
  if (r.figees) parts.push(`${r.figees} tournée${r.figees > 1 ? "s" : ""} déjà démarrée${r.figees > 1 ? "s" : ""}, inchangée${r.figees > 1 ? "s" : ""}`);
  if (r.fermees) parts.push(`${r.fermees} tournée${r.fermees > 1 ? "s" : ""} fermée${r.fermees > 1 ? "s" : ""}, inchangée${r.fermees > 1 ? "s" : ""} (à rouvrir pour la modifier)`);
  if (r.fusionnees) parts.push(`${r.fusionnees} tournée${r.fusionnees > 1 ? "s" : ""} fusionnée${r.fusionnees > 1 ? "s" : ""}, inchangée${r.fusionnees > 1 ? "s" : ""} (modifiez la tournée qui les regroupe)`);
  return parts.join(", ") || "Rien à changer";
}


// ---------------------------------------------------------------------------
// Fiche Tournée colis de l'ancien chauffeur quand on change de chauffeur.
// ---------------------------------------------------------------------------

export type SortFiche = "supprimer" | "detacher" | "garder";

/**
 * Que faire de la fiche colis qui porte l'affectation quand son chauffeur
 * change (ou est retiré) ?
 * - fiche déjà commencée (plus en chargement, ou un arrêt déjà livré /
 *   en échec) : on n'y touche pas, l'encadrement est prévenu ;
 * - fiche qui porte aussi d'autres tournées (reliée) : l'affectation s'en
 *   détache, la fiche reste à l'ancien chauffeur pour ses autres tournées ;
 * - fiche créée pour cette seule affectation : supprimée (elle sera refaite
 *   pour le nouveau chauffeur) ;
 * - fiche libre du chauffeur : l'affectation s'en détache.
 */
export function sortFicheAncienChauffeur(p: { statut: string; arretsTraites: number; autresEntrees: number; fichePlanifiee: boolean; creeePourCetteAffectation: boolean }): SortFiche {
  if (p.statut !== "loading" || p.arretsTraites > 0) return "garder";
  if (p.autresEntrees > 0) return "detacher";
  if (p.fichePlanifiee && p.creeePourCetteAffectation) return "supprimer";
  return "detacher";
}
