/**
 * Horaires d'ouverture des adresses professionnelles dans la tournée colis.
 *
 * - Annuaire de l'entreprise (table delivery_address_hours) : semaine type
 *   d'une adresse, 0 à 2 créneaux par jour (ex. 8:00–12:00 et 14:00–18:00),
 *   jour fermé = liste vide, jour absent = pas de contrainte connue.
 * - Créneau ponctuel d'un arrêt (window_start / window_end, ex. « avant
 *   10 h ») : prioritaire sur l'annuaire.
 *
 * Toutes les heures sont en minutes depuis minuit, heure de Paris, le jour
 * de la tournée. Le calcul des heures d'arrivée reprend le modèle de
 * lib/colis/estimation.ts (distance × 1,3 à 35 km/h + 3 min par arrêt).
 *
 * Optimisation avec horaires : on part de l'ordre habituel (plus proche
 * voisin + 2-opt + Or-opt, lib/colis/optimisation.ts), puis une passe de
 * réparation / amélioration déplace les arrêts à horaires là où ils sont
 * servis dans leur créneau pour le moindre temps total (attente comprise :
 * attendre l'ouverture est accepté quand c'est moins coûteux qu'un
 * détour), et n'accepte aucun mouvement qui crée un nouveau hors-horaires.
 * Les adresses fermées ce jour-là, ou qu'on ne peut plus atteindre avant
 * la fermeture, passent en fin de liste et sont signalées.
 */
import { distanceKm, optimiserOrdre, plusProcheVoisin, type Point } from "@/lib/colis/optimisation";
import { MINUTES_PAR_ARRET, minutesTrajet } from "@/lib/colis/estimation";
import { dateParis, jourIso, minutesParis } from "@/lib/colis/heure-paris";

export { dateParis, instantParis, jourIso, minutesParis } from "@/lib/colis/heure-paris";

export type Jour = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface Creneau {
  open: string;
  close: string;
}
/** Semaine type : clé "1" (lundi) à "7" (dimanche). */
export type Semaine = Partial<Record<`${Jour}`, Creneau[]>>;
/** Fenêtres d'un arrêt pour le jour : null = aucune contrainte, [] = fermé. */
export type Fenetres = [number, number][] | null;

export const JOURS: { n: Jour; court: string; long: string }[] = [
  { n: 1, court: "Lun", long: "Lundi" },
  { n: 2, court: "Mar", long: "Mardi" },
  { n: 3, court: "Mer", long: "Mercredi" },
  { n: 4, court: "Jeu", long: "Jeudi" },
  { n: 5, court: "Ven", long: "Vendredi" },
  { n: 6, court: "Sam", long: "Samedi" },
  { n: 7, court: "Dim", long: "Dimanche" },
];
/** Fiche « adresse pro » de l'annuaire des horaires de l'entreprise. */
export interface FicheHoraires {
  id: string;
  address_key: string;
  label: string | null;
  address: string;
  weekly_schedule: Semaine;
  notes: string | null;
  updated_at: string;
  /** Origine : saisie manuelle, ou trouvée sur internet (openstreetmap, google) — migration 190. */
  source?: string | null;
  found_at?: string | null;
}

export const MAX_CRENEAUX = 2;
/** Heure de départ par défaut d'une tournée (avant le départ réel). */
export const DEPART_PAR_DEFAUT = 8 * 60;

// ── Lecture / écriture des heures ───────────────────────────────

/** « 8:00 », « 08:00:00 » (Postgres), « 8h30 », « 8 h » → minutes ; null si illisible. */
export function lireHeure(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^\s*(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?(?::\d{2})?\s*$/i.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** Minutes → « 08:00 » (stockage). */
export function ecrireHeure(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes → « 8:00 » (affichage) ; au-delà de minuit, on reste sur 24 h. */
export function afficherHeure(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Créneaux valides d'un jour : triés, fusionnés s'ils se chevauchent, 2 au plus. */
function normaliserJour(v: unknown): Creneau[] {
  if (!Array.isArray(v)) return [];
  const bruts = v
    .map((c): [number | null, number | null] => (c && typeof c === "object" ? [lireHeure((c as Creneau).open), lireHeure((c as Creneau).close)] : [null, null]))
    .filter((c): c is [number, number] => c[0] !== null && c[1] !== null && c[0] < c[1])
    .sort((a, b) => a[0] - b[0]);
  const fusion: [number, number][] = [];
  for (const c of bruts) {
    const der = fusion[fusion.length - 1];
    if (der && c[0] <= der[1]) der[1] = Math.max(der[1], c[1]);
    else fusion.push([...c]);
  }
  return fusion.slice(0, MAX_CRENEAUX).map(([o, f]) => ({ open: ecrireHeure(o), close: ecrireHeure(f) }));
}

/**
 * Semaine type normalisée depuis une saisie ou du JSON stocké : seuls les
 * jours 1 à 7 présents sont gardés ; un jour sans créneau valide = fermé.
 */
export function normaliserSemaine(v: unknown): Semaine {
  const s: Semaine = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return s;
  for (const { n } of JOURS) {
    const jour = (v as Record<string, unknown>)[String(n)];
    if (jour !== undefined && jour !== null) s[`${n}`] = normaliserJour(jour);
  }
  return s;
}

/**
 * Convertit les horaires OpenStreetMap simples en semaine ISO.
 * Exemples pris en charge : "Mo-Fr 08:00-12:00,14:00-18:00; Sa 09:00-12:00; Su off".
 * Les règles complexes (jours fériés, dates, semaines alternées, sunrise/sunset)
 * sont ignorées plutôt que d'inventer des horaires.
 */
export function convertirHorairesOSM(value: string | null | undefined): Semaine | null {
  if (!value || value.length > 500) return null;
  const index: Record<string, Jour> = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 7 };
  const semaine: Semaine = {};
  let reconnu = false;

  for (const regle of value.split(";").map((x) => x.trim()).filter(Boolean)) {
    const espace = regle.search(/\s/);
    if (espace < 0) continue;
    const joursTexte = regle.slice(0, espace).trim();
    const plageTexte = regle.slice(espace + 1).trim();
    const actifs = new Set<Jour>();

    for (const groupe of joursTexte.split(",")) {
      const morceaux = groupe.split("-");
      const debut = index[morceaux[0] ?? ""];
      const fin = index[morceaux[1] ?? morceaux[0] ?? ""];
      if (!debut || !fin || morceaux.length > 2) continue;
      let j = debut;
      for (let i = 0; i < 7; i++) {
        actifs.add(j);
        if (j === fin) break;
        j = ((j % 7) + 1) as Jour;
      }
    }
    if (!actifs.size) continue;

    if (/^(off|closed)$/i.test(plageTexte)) {
      for (const j of actifs) semaine[`${j}`] = [];
      reconnu = true;
      continue;
    }

    const plages = plageTexte.match(/\d{1,2}:\d{2}-\d{1,2}:\d{2}/g) ?? [];
    const creneaux: Creneau[] = [];
    for (const plage of plages) {
      const [debut, fin] = plage.split("-");
      const ouverture = lireHeure(debut);
      const fermeture = lireHeure(fin);
      if (ouverture !== null && fermeture !== null && ouverture < fermeture) {
        creneaux.push({ open: ecrireHeure(ouverture), close: ecrireHeure(fermeture) });
      }
    }
    if (!creneaux.length) continue;
    for (const j of actifs) semaine[`${j}`] = [...(semaine[`${j}`] ?? []), ...creneaux];
    reconnu = true;
  }

  return reconnu ? normaliserSemaine(semaine) : null;
}

/** Créneaux d'un jour de la semaine type ; null si ce jour n'est pas renseigné. */
export function creneauxDuJour(semaine: Semaine | null | undefined, jour: Jour): Creneau[] | null {
  return semaine?.[`${jour}`] ?? null;
}

// ── Préréglages de saisie ───────────────────────────────────────

const SEMAINE_OUVREE: Jour[] = [1, 2, 3, 4, 5];

/** Applique les mêmes créneaux du lundi au vendredi (le week-end ne change pas). */
export function appliquerDuLundiAuVendredi(semaine: Semaine, creneaux: Creneau[]): Semaine {
  const s = { ...semaine };
  for (const j of SEMAINE_OUVREE) s[`${j}`] = creneaux.map((c) => ({ ...c }));
  return s;
}

export const PRESETS: { cle: string; libelle: string; appliquer: (s: Semaine) => Semaine }[] = [
  {
    cle: "coupure",
    libelle: "8h–12h / 14h–18h du lundi au vendredi",
    appliquer: (s) =>
      appliquerDuLundiAuVendredi(s, [
        { open: "08:00", close: "12:00" },
        { open: "14:00", close: "18:00" },
      ]),
  },
  { cle: "continue", libelle: "Journée continue 8h–18h", appliquer: (s) => appliquerDuLundiAuVendredi(s, [{ open: "08:00", close: "18:00" }]) },
  { cle: "samedi", libelle: "Fermé le samedi", appliquer: (s) => ({ ...s, "6": [] }) },
  { cle: "dimanche", libelle: "Fermé le dimanche", appliquer: (s) => ({ ...s, "7": [] }) },
];

// ── Fenêtres d'un arrêt pour un jour donné ──────────────────────

export interface SourceHoraires {
  /** Semaine type de l'annuaire (adresse pro), si l'adresse y figure. */
  semaine?: Semaine | null;
  /** Créneau ponctuel de l'arrêt (« 08:00 », « 10:00:00 »…), prioritaire. */
  debut?: string | null;
  fin?: string | null;
}

/** true si l'arrêt a un créneau ponctuel (qui remplace l'annuaire). */
export function aCreneauPonctuel(src: SourceHoraires): boolean {
  return lireHeure(src.debut) !== null || lireHeure(src.fin) !== null;
}

/**
 * Fenêtres de l'arrêt le jour `ymd` (AAAA-MM-JJ, heure de Paris) : créneau
 * ponctuel s'il existe, sinon créneaux de ce jour dans l'annuaire.
 */
export function fenetresArret(src: SourceHoraires, ymd: string): Fenetres {
  const debut = lireHeure(src.debut);
  const fin = lireHeure(src.fin);
  if (debut !== null || fin !== null) {
    const d = debut ?? 0;
    const f = fin ?? 1440;
    return f > d ? [[d, f]] : null;
  }
  const creneaux = creneauxDuJour(src.semaine ? normaliserSemaine(src.semaine) : null, jourIso(ymd));
  if (!creneaux) return null;
  return creneaux.map((c) => [lireHeure(c.open)!, lireHeure(c.close)!]);
}

/** Badge d'un arrêt : « Ouvert 8:00–12:00 · 14:00–18:00 », « Fermé aujourd'hui », « Avant 10:00 »… */
export function libelleFenetres(f: Fenetres, ponctuel = false): string | null {
  if (f === null) return null;
  if (!f.length) return "Fermé aujourd'hui";
  if (ponctuel) {
    const [d, e] = f[0]!;
    if (d <= 0) return `Avant ${afficherHeure(e)}`;
    if (e >= 1440) return `À partir de ${afficherHeure(d)}`;
    return `Créneau ${afficherHeure(d)}–${afficherHeure(e)}`;
  }
  return `Ouvert ${f.map(([d, e]) => `${afficherHeure(d)}–${e >= 1440 ? "24:00" : afficherHeure(e)}`).join(" · ")}`;
}

/** Résumé d'une semaine type : « Lun–Ven 8:00–12:00 · 14:00–18:00 · Sam, Dim fermé ». */
export function resumeSemaine(semaine: Semaine): string {
  const texte = (j: Jour) => {
    const c = semaine[`${j}`];
    if (!c) return null;
    if (!c.length) return "fermé";
    return c.map((x) => `${afficherHeure(lireHeure(x.open)!)}–${afficherHeure(lireHeure(x.close)!)}`).join(" · ");
  };
  const blocs: { jours: Jour[]; texte: string }[] = [];
  for (const { n } of JOURS) {
    const t = texte(n);
    if (t === null) continue;
    const der = blocs[blocs.length - 1];
    if (der && der.texte === t && der.jours[der.jours.length - 1] === n - 1) der.jours.push(n);
    else blocs.push({ jours: [n], texte: t });
  }
  const nom = (j: Jour) => JOURS[j - 1]!.court;
  return blocs
    .map((b) => `${b.jours.length > 2 ? `${nom(b.jours[0]!)}–${nom(b.jours[b.jours.length - 1]!)}` : b.jours.map(nom).join(", ")} ${b.texte}`)
    .join(" · ");
}

// ── Heures de passage ───────────────────────────────────────────

export type StatutPassage = "libre" | "ok" | "hors" | "ferme";
export interface Passage {
  /** Arrivée sur place (minutes depuis minuit, Paris). */
  arrivee: number;
  /** Début de la remise : arrivée, ou ouverture si on attend. */
  debut: number;
  attente: number;
  /** libre : sans horaires ; ok : dans un créneau ; hors : après la fermeture ; ferme : fermé ce jour-là. */
  statut: StatutPassage;
}

/** Remise à l'heure `t` : attente jusqu'à l'ouverture si on arrive en avance. */
export function servir(t: number, f: Fenetres): { debut: number; statut: StatutPassage; retard: number } {
  if (f === null) return { debut: t, statut: "libre", retard: 0 };
  if (!f.length) return { debut: t, statut: "ferme", retard: 0 };
  for (const [o, c] of f) if (t < c) return { debut: Math.max(t, o), statut: "ok", retard: 0 };
  return { debut: t, statut: "hors", retard: t - f[f.length - 1]![1] };
}

export interface ArretPlanifiable {
  point: Point | null;
  fenetres: Fenetres;
}

/**
 * Heures de passage d'une suite d'arrêts dans l'ordre donné, en partant de
 * `depart` à `minute`. Un arrêt sans coordonnées compte pour 0 km (son
 * heure est approximative).
 */
export function simulerPassages(
  depart: { point: Point | null; minute: number },
  arrets: ArretPlanifiable[],
  minutesParArret = MINUTES_PAR_ARRET,
  options: { distance?: (a: Point, b: Point) => number } = {},
): { passages: Passage[]; fin: number; dernier: Point | null } {
  const distance = options.distance ?? distanceKm;
  let t = depart.minute;
  let prec = depart.point;
  const passages = arrets.map((a) => {
    if (prec && a.point) t += minutesTrajet(distance(prec, a.point));
    if (a.point) prec = a.point;
    const s = servir(t, a.fenetres);
    const p: Passage = { arrivee: t, debut: s.debut, attente: s.debut - t, statut: s.statut };
    t = s.debut + minutesParArret;
    return p;
  });
  return { passages, fin: t, dernier: prec };
}

// ── Ordre de passage avec horaires ──────────────────────────────

const PENALITE_HORS = 10_000;
const PENALITE_RETARD = 10;
/** Garde-fou de calcul (ms) pour les très grosses listes. */
const BUDGET_MS = 1500;

interface Probleme {
  debut: number;
  service: number;
  depuisDepart: number[];
  t: number[][];
  versFin: number[];
  fen: Fenetres[];
}

function evaluer(p: Probleme, ordre: number[]) {
  let t = p.debut;
  let prec = -1;
  let hors = 0;
  let retard = 0;
  let urgence = 0;
  for (const i of ordre) {
    t += prec < 0 ? p.depuisDepart[i]! : p.t[prec]![i]!;
    const fenetres = p.fen[i]!;
    // Une fermeture proche doit peser dans l'ordre même si les deux arrêts
    // restent techniquement livrables : on évite de perdre la marge restante
    // sur une adresse à échéance serrée pour gagner quelques minutes de trajet.
    if (fenetres?.length) {
      const fermeture = fenetres[fenetres.length - 1]![1];
      const marge = fermeture - t;
      urgence += Math.max(0, 30 - marge) * 50;
    }
    const s = servir(t, fenetres);
    if (s.statut === "hors") {
      hors++;
      retard += s.retard;
    }
    t = s.debut + p.service;
    prec = i;
  }
  if (prec >= 0) t += p.versFin[prec]!;
  return { hors, cout: hors * PENALITE_HORS + retard * PENALITE_RETARD + urgence + (t - p.debut) };
}

/**
 * Ordre de passage d'une liste en tenant compte des horaires. Renvoie les
 * indices dans l'ordre (fermés et impossibles en fin de liste) et ceux à
 * signaler. Sans aucun horaire, l'ordre est exactement celui de
 * optimiserOrdre.
 */
export function ordonnerAvecHoraires(
  depart: Point | null,
  arrets: { point: Point; fenetres: Fenetres }[],
  options: {
    debut: number;
    retour?: boolean;
    arrivee?: Point | null;
    minutesParArret?: number;
    distance?: (a: Point, b: Point) => number;
    /** « proche » : prochaine adresse la plus proche ; seuls les horaires déplacent un arrêt. Défaut : « optimal » (plus court trajet). */
    strategie?: "optimal" | "proche";
  },
): { ordre: number[]; fermes: number[]; impossibles: number[] } {
  const { debut, retour = true, arrivee = null, minutesParArret = MINUTES_PAR_ARRET, distance = distanceKm, strategie = "optimal" } = options;
  const n = arrets.length;
  const trajet = (a: Point | null, b: Point | null) => (a && b ? minutesTrajet(distance(a, b)) : 0);
  const fermes: number[] = [];
  const impossibles: number[] = [];
  const reste: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = arrets[i]!.fenetres;
    if (f && !f.length) fermes.push(i);
    // Même en y allant directement, on arriverait après la dernière fermeture :
    // inutile de le laisser peser sur l'ordre des autres. Les arrêts encore
    // atteignables sont laissés à l'optimiseur (l'arrivée dépend de l'ordre).
    else if (f && debut + trajet(depart, arrets[i]!.point) >= f[f.length - 1]![1]) impossibles.push(i);
    else reste.push(i);
  }

  const points = reste.map((i) => arrets[i]!.point);
  const initial = (strategie === "proche" ? plusProcheVoisin(depart, points, distance) : optimiserOrdre(depart, points, retour, arrivee, distance)).map((k) => reste[k]!);

  let ordre = initial;
  if (reste.some((i) => arrets[i]!.fenetres)) {
    const fin = arrivee ?? (retour ? depart : null);
    const p: Probleme = {
      debut,
      service: minutesParArret,
      depuisDepart: arrets.map((a) => trajet(depart, a.point)),
      t: arrets.map((a) => arrets.map((b) => trajet(a.point, b.point))),
      versFin: arrets.map((a) => trajet(a.point, fin)),
      fen: arrets.map((a) => a.fenetres),
    };
    ordre = ameliorer(p, initial, (i) => arrets[i]!.fenetres !== null, strategie !== "proche");

  }
  return { ordre: [...ordre, ...impossibles, ...fermes], fermes, impossibles };
}

/**
 * Réparation puis amélioration locale :
 * 1. chaque arrêt à horaires est réinséré à la position qui minimise le
 *    coût (hors-horaires d'abord, puis retard, puis durée totale) ;
 * 2. déplacements d'un arrêt quelconque et inversions de segment (2-opt),
 *    acceptés seulement s'ils réduisent le coût sans ajouter de
 *    hors-horaires.
 */
function ameliorer(p: Probleme, initial: number[], aHoraires: (i: number) => boolean, generale = true): number[] {
  const t0 = Date.now();
  let ordre = [...initial];
  let actuel = evaluer(p, ordre);
  const essayer = (candidat: number[]) => {
    const e = evaluer(p, candidat);
    if (e.hors <= actuel.hors && e.cout + 1e-6 < actuel.cout) {
      ordre = candidat;
      actuel = e;
      return true;
    }
    return false;
  };
  const deplacer = (filtre: (i: number) => boolean) => {
    let mieux = false;
    for (const x of [...ordre]) {
      if (!filtre(x)) continue;
      const sans = ordre.filter((y) => y !== x);
      let meilleur: number[] | null = null;
      let meilleurCout = actuel.cout;
      let meilleurHors = actuel.hors;
      for (let pos = 0; pos <= sans.length; pos++) {
        const c = [...sans.slice(0, pos), x, ...sans.slice(pos)];
        const e = evaluer(p, c);
        if (e.hors <= meilleurHors && e.cout + 1e-6 < meilleurCout) {
          meilleur = c;
          meilleurCout = e.cout;
          meilleurHors = e.hors;
        }
      }
      if (meilleur) {
        ordre = meilleur;
        actuel = { hors: meilleurHors, cout: meilleurCout };
        mieux = true;
      }
    }
    return mieux;
  };

  // 1. Réparation : arrêts à horaires d'abord.
  for (let passe = 0; passe < 5 && deplacer(aHoraires); passe++) if (Date.now() - t0 > BUDGET_MS) return ordre;

  // 2. Amélioration générale (pas en « prochaine adresse la plus proche » : seuls les horaires déplacent un arrêt).
  if (!generale) return ordre;
  for (let passe = 0; passe < 20; passe++) {
    let mieux = deplacer(() => true);
    for (let i = 0; i < ordre.length - 1; i++) {
      for (let k = i + 1; k < ordre.length; k++) {
        if (essayer([...ordre.slice(0, i), ...ordre.slice(i, k + 1).reverse(), ...ordre.slice(k + 1)])) mieux = true;
      }
      if (Date.now() - t0 > BUDGET_MS) return ordre;
    }
    if (!mieux) break;
  }
  return ordre;
}

// ── Départ de la tournée ────────────────────────────────────────

/**
 * Jour et heure (minutes, Paris) à partir desquels on calcule les heures
 * de passage : maintenant en cours de route, sinon l'heure de départ prévue
 * (08:00 par défaut) du jour de la tournée — et pas avant maintenant si
 * la tournée est pour aujourd'hui.
 */
export function heureDepart(
  run: { status: string; run_date: string; planned_start?: string | null },
  maintenant: Date,
  enRoute = run.status === "in_progress",
): { jour: string; minute: number } {
  const today = dateParis(maintenant);
  const now = minutesParis(maintenant);
  if (enRoute || run.run_date < today) return { jour: today, minute: now };
  const prevu = lireHeure(run.planned_start) ?? DEPART_PAR_DEFAUT;
  return { jour: run.run_date, minute: run.run_date === today ? Math.max(prevu, now) : prevu };
}

/**
 * Heures de passage des arrêts restants d'une tournée, dans l'ordre
 * affiché (pour l'écran du chauffeur et de l'exploitation).
 */
export function passagesTournee(
  arrets: { id: string; status: string; lat: number | string | null; lng: number | string | null; fenetres: Fenetres }[],
  depart: { point: Point | null; minute: number },
): Map<string, Passage> {
  const restants = arrets.filter((a) => a.status === "pending");
  const { passages } = simulerPassages(
    depart,
    restants.map((a) => ({ point: a.lat === null || a.lng === null ? null : { lat: Number(a.lat), lng: Number(a.lng) }, fenetres: a.fenetres })),
  );
  return new Map(restants.map((a, i) => [a.id, passages[i]!]));
}
