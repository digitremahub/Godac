/**
 * Sens habituel d'une tournée : l'ordre dans lequel les secteurs (villages,
 * communes, listes de la tournée) sont normalement parcourus, appris des
 * tournées réellement réalisées (ordre effectif des arrêts clôturés) pour un
 * même modèle de tournée, sinon un même chauffeur et un même service.
 *
 * Ce module est PUR (aucune base, aucun réseau) ; il est testé dans
 * lib/colis/__tests__/sens-tournee.test.ts. L'enregistrement et la lecture
 * en base sont dans lib/colis/sens-serveur.ts.
 *
 * Principe du biais : un biais DOUX, jamais une contrainte.
 *  - coût biaisé = km × (1 + λ × désordre), où « désordre » (0 à 1) est la
 *    part des paires de secteurs parcourues dans l'ordre inverse de l'habitude
 *    et λ vaut LAMBDA_SENS (4 %), borné à LAMBDA_MAX (10 %) ;
 *  - à longueur égale, l'ordre habituel gagne (départage) ;
 *  - un ordre habituel plus long de plus de λ n'est jamais retenu : pas de
 *    détour manifeste ;
 *  - les horaires et fenêtres d'ouverture ne sont jamais sacrifiés :
 *    biaisSansRisque() compare le résultat avec et sans biais et écarte le biais
 *    s'il crée un hors-horaires ou retarde la fin.
 */
import { normaliserTexte } from "@/lib/colis/professionnel";

/** Nombre de tournées gardées pour apprendre l'habitude. */
export const HISTORIQUE_MAX = 8;
/** Tournées réalisées (avec au moins deux secteurs) nécessaires avant de parler d'habitude. */
export const OBSERVATIONS_MIN = 2;
/** Poids du biais : +4 % de longueur par unité de désordre. */
export const LAMBDA_SENS = 0.04;
/** Plafond absolu du biais (aucun réglage ne peut le dépasser). */
export const LAMBDA_MAX = 0.1;
/** Un secteur compte dans l'habitude s'il apparaît dans au moins ce nombre de tournées. */
export const APPARITIONS_MIN = 2;
/** Accord minimal entre les tournées observées (0,5 = hasard, 1 = toujours le même ordre). */
export const ACCORD_MIN = 0.6;
/** Décroissance de l'ancienneté : la tournée précédente pèse 85 % de la suivante. */
export const OUBLI_PAR_TOURNEE = 0.85;
/** Fin de tournée tolérée en plus (minutes) quand le biais est appliqué avec des horaires. */
export const TOLERANCE_FIN_MIN = 10;

export type ModeSens = "habituel" | "inverse" | "libre";
export const MODES_SENS: readonly ModeSens[] = ["habituel", "inverse", "libre"];

export interface Secteur {
  /** Clé normalisée (minuscules, sans accents) : « soulac ». */
  cle: string;
  /** Nom affiché : « Soulac ». */
  nom: string;
}

/** Ordre dans lequel les secteurs ont été parcourus lors d'une tournée clôturée. */
export interface ObservationSens {
  run_id: string;
  /** Date de la tournée (AAAA-MM-JJ). */
  date: string;
  ordre: Secteur[];
}

export interface HabitudeSens {
  ordre: Secteur[];
  /** Nombre de tournées observées. */
  observations: number;
  /** Accord moyen entre les tournées sur l'ordre des paires de secteurs (0,5 à 1). */
  accord: number;
}

export const cleSecteur = (nom: string): string => normaliserTexte(nom);

export const lireMode = (v: unknown): ModeSens => (MODES_SENS as readonly unknown[]).includes(v) ? (v as ModeSens) : "habituel";

/**
 * Portée de l'habitude : le modèle de tournée (tour_routes) s'il existe, sinon
 * le couple chauffeur + service. Une tournée sans modèle ni chauffeur n'a pas de portée.
 */
export function portee(run: { route_id?: string | null; driver_id?: string | null; service_id?: string | null }): string | null {
  if (run.route_id) return `route:${run.route_id}`;
  if (run.driver_id) return `chauffeur:${run.driver_id}:service:${run.service_id ?? "-"}`;
  return null;
}

// ── Apprentissage ───────────────────────────────────────────────

interface ListeLue {
  id: string;
  name: string;
}
interface ArretLu {
  list_id?: string | null;
  status: string;
  done_at?: string | null;
}

const mediane = (v: number[]): number => {
  const t = [...v].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m]! : (t[m - 1]! + t[m]!) / 2;
};

/**
 * Ordre effectif des secteurs d'une tournée : les listes triées par l'heure
 * médiane de clôture de leurs arrêts (livrés ou en échec). Les listes
 * exclues (par exemple « Reportés ») et celles sans arrêt clôturé sont ignorées.
 */
export function ordreObserve(arrets: readonly ArretLu[], listes: readonly ListeLue[], exclure: (l: ListeLue) => boolean = () => false): Secteur[] {
  const temps = new Map<string, number[]>();
  for (const a of arrets) {
    if (a.status === "pending" || !a.list_id || !a.done_at) continue;
    const t = Date.parse(a.done_at);
    if (!Number.isFinite(t)) continue;
    temps.set(a.list_id, [...(temps.get(a.list_id) ?? []), t]);
  }
  const secteurs: { secteur: Secteur; t: number }[] = [];
  const vus = new Set<string>();
  for (const l of listes) {
    const ts = temps.get(l.id);
    const nom = l.name.trim();
    if (!ts || !nom || exclure(l)) continue;
    const cle = cleSecteur(nom);
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);
    secteurs.push({ secteur: { cle, nom }, t: mediane(ts) });
  }
  return secteurs.sort((a, b) => a.t - b.t).map((s) => s.secteur);
}

/** Historique validé depuis le JSON stocké (jamais de confiance aveugle). */
export function lireHistorique(v: unknown): ObservationSens[] {
  if (!Array.isArray(v)) return [];
  const out: ObservationSens[] = [];
  for (const o of v) {
    if (!o || typeof o !== "object") continue;
    const { run_id, date, ordre } = o as Record<string, unknown>;
    if (typeof run_id !== "string" || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(ordre)) continue;
    const secteurs: Secteur[] = [];
    for (const s of ordre) {
      const { cle, nom } = (s ?? {}) as Record<string, unknown>;
      if (typeof cle === "string" && typeof nom === "string" && cle && nom && !secteurs.some((x) => x.cle === cle)) secteurs.push({ cle: cle.slice(0, 80), nom: nom.slice(0, 80) });
    }
    if (secteurs.length >= 2) out.push({ run_id: run_id.slice(0, 64), date, ordre: secteurs.slice(0, 30) });
  }
  return out.slice(0, HISTORIQUE_MAX);
}

/**
 * Ajoute (ou remplace, pour la même tournée : idempotent) une observation, les
 * plus récentes d'abord, au plus HISTORIQUE_MAX. Une observation de moins de
 * deux secteurs n'apprend rien : elle est ignorée.
 */
export function ajouterObservation(historique: readonly ObservationSens[], obs: ObservationSens): ObservationSens[] {
  if (obs.ordre.length < 2) return [...historique];
  const sans = historique.filter((h) => h.run_id !== obs.run_id);
  return [...sans, obs].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1)).slice(0, HISTORIQUE_MAX);
}

/**
 * Habitude de parcours déduite de l'historique : ordre consensuel des secteurs
 * (vainqueur de Condorcet / Copeland pondéré par l'ancienneté). `oublieLe` :
 * date (AAAA-MM-JJ) avant laquelle les tournées sont oubliées (« Oublier l'habitude »).
 * Renvoie null s'il y a moins de OBSERVATIONS_MIN tournées exploitables, moins de
 * deux secteurs réguliers, ou si les tournées se contredisent (accord < ACCORD_MIN).
 */
export function apprendreSens(historique: readonly ObservationSens[], oublieLe: string | null = null): HabitudeSens | null {
  const obs = historique.filter((h) => h.ordre.length >= 2 && (!oublieLe || h.date > oublieLe)).slice(0, HISTORIQUE_MAX);
  if (obs.length < OBSERVATIONS_MIN) return null;
  const poids = obs.map((_, i) => OUBLI_PAR_TOURNEE ** i);

  const apparitions = new Map<string, number>();
  const noms = new Map<string, string>();
  for (const o of obs) {
    for (const s of o.ordre) {
      apparitions.set(s.cle, (apparitions.get(s.cle) ?? 0) + 1);
      if (!noms.has(s.cle)) noms.set(s.cle, s.nom); // la plus récente fait foi
    }
  }
  const cles = [...apparitions].filter(([, n]) => n >= APPARITIONS_MIN).map(([c]) => c);
  if (cles.length < 2) return null;

  // Préférence pondérée de chaque paire : > 0 si a est plutôt avant b.
  const rang = obs.map((o) => new Map(o.ordre.map((s, i) => [s.cle, i])));
  const prefere = (a: string, b: string): { net: number; total: number } => {
    let net = 0;
    let total = 0;
    rang.forEach((r, k) => {
      const ra = r.get(a);
      const rb = r.get(b);
      if (ra === undefined || rb === undefined) return;
      total += poids[k]!;
      net += ra < rb ? poids[k]! : -poids[k]!;
    });
    return { net, total };
  };

  let accordSomme = 0;
  let paires = 0;
  const score = new Map<string, number>();
  for (const c of cles) score.set(c, 0);
  for (let i = 0; i < cles.length; i++) {
    for (let j = i + 1; j < cles.length; j++) {
      const { net, total } = prefere(cles[i]!, cles[j]!);
      if (total <= 0) continue;
      accordSomme += (total + Math.abs(net)) / 2 / total;
      paires++;
      if (net > 1e-9) {
        score.set(cles[i]!, score.get(cles[i]!)! + 1);
        score.set(cles[j]!, score.get(cles[j]!)! - 1);
      } else if (net < -1e-9) {
        score.set(cles[j]!, score.get(cles[j]!)! + 1);
        score.set(cles[i]!, score.get(cles[i]!)! - 1);
      }
    }
  }
  if (!paires) return null;
  const accord = accordSomme / paires;
  if (accord < ACCORD_MIN) return null;

  // Rang moyen normalisé (0 à 1), pondéré : départage les égalités de score.
  const rangMoyen = (c: string): number => {
    let somme = 0;
    let p = 0;
    obs.forEach((o, k) => {
      const i = o.ordre.findIndex((s) => s.cle === c);
      if (i < 0) return;
      somme += (i / Math.max(1, o.ordre.length - 1)) * poids[k]!;
      p += poids[k]!;
    });
    return p ? somme / p : 0.5;
  };
  const ordre = [...cles]
    .sort((a, b) => score.get(b)! - score.get(a)! || rangMoyen(a) - rangMoyen(b) || (a < b ? -1 : 1))
    .map((cle) => ({ cle, nom: noms.get(cle)! }));
  return { ordre, observations: obs.length, accord: Math.round(accord * 100) / 100 };
}

// ── Application ─────────────────────────────────────────────────

/** Ordre de référence (clés) pour un mode : habituel, inverse, ou null (aucun biais). */
export function referenceSens(habitude: HabitudeSens | null, mode: ModeSens): string[] | null {
  if (!habitude || mode === "libre") return null;
  const cles = habitude.ordre.map((s) => s.cle);
  return mode === "inverse" ? cles.reverse() : cles;
}

/** Part (0 à 1) des paires de secteurs communs parcourues dans l'ordre inverse de la référence. */
export function desordre(ordre: readonly string[], reference: readonly string[]): number {
  const rang = new Map(reference.map((c, i) => [c, i]));
  const communs = ordre.filter((c) => rang.has(c));
  const n = communs.length;
  if (n < 2) return 0;
  let inversions = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rang.get(communs[i]!)! > rang.get(communs[j]!)!) inversions++;
  return inversions / ((n * (n - 1)) / 2);
}

/** Poids du biais borné : jamais négatif, jamais au-delà de LAMBDA_MAX. */
export const lambdaBorne = (lambda: number = LAMBDA_SENS): number => (Number.isFinite(lambda) ? Math.min(LAMBDA_MAX, Math.max(0, lambda)) : LAMBDA_SENS);

/** Coût comparé par l'optimisation : la longueur, majorée de λ × désordre (au plus +10 %). */
export function coutBiaise(km: number, desordreSens: number, lambda: number = LAMBDA_SENS): number {
  return km * (1 + lambdaBorne(lambda) * Math.min(1, Math.max(0, desordreSens)));
}

/**
 * Ordre de référence appliqué à un ensemble d'éléments : ceux dont la clé est
 * connue suivent la référence ; les autres (secteur nouveau, absent de
 * l'habitude) sont insérés à la position qui coûte le moins (`cout`).
 */
export function ordonnerSelonReference<T>(items: readonly T[], cle: (t: T) => string, reference: readonly string[], cout: (ordre: T[]) => number): T[] {
  const rang = new Map(reference.map((c, i) => [c, i]));
  const connus = items.filter((t) => rang.has(cle(t))).sort((a, b) => rang.get(cle(a))! - rang.get(cle(b))!);
  const inconnus = items.filter((t) => !rang.has(cle(t)));
  let ordre = connus;
  for (const x of inconnus) {
    let meilleur: T[] | null = null;
    let meilleurCout = Infinity;
    for (let p = 0; p <= ordre.length; p++) {
      const essai = [...ordre.slice(0, p), x, ...ordre.slice(p)];
      const c = cout(essai);
      if (c < meilleurCout - 1e-9) {
        meilleur = essai;
        meilleurCout = c;
      }
    }
    ordre = meilleur ?? [...ordre, x];
  }
  return ordre;
}

export interface BilanOrdre {
  /** Arrêts servis après leur fermeture. */
  hors: number;
  /** Arrêts fermés ce jour-là ou injoignables avant la fermeture. */
  ecartes: number;
  /** Fin estimée de la tournée (minutes), null si inconnue. */
  fin: number | null;
}

/**
 * Le biais est-il sans risque pour les horaires ? Faux dès qu'il ajoute un
 * arrêt hors horaires ou écarté, ou retarde la fin de plus de TOLERANCE_FIN_MIN.
 */
export function biaisSansRisque(neutre: BilanOrdre, biaise: BilanOrdre, toleranceMin: number = TOLERANCE_FIN_MIN): boolean {
  if (biaise.hors > neutre.hors || biaise.ecartes > neutre.ecartes) return false;
  if (neutre.fin !== null && biaise.fin !== null && biaise.fin > neutre.fin + toleranceMin) return false;
  return true;
}

// ── Affichage ───────────────────────────────────────────────────

/** « Soulac → Vendays → Hourtin » (au plus `max` secteurs, le dernier toujours montré). */
export function libelleSens(ordre: readonly Secteur[], max = 5): string {
  const noms = ordre.map((s) => s.nom);
  if (noms.length <= max) return noms.join(" → ");
  return `${noms.slice(0, max - 1).join(" → ")} → … → ${noms[noms.length - 1]}`;
}

export type Orientation = "horaire" | "antihoraire";

/**
 * Rotation autour du dépôt dans l'ordre des secteurs : somme des écarts
 * d'angle (en degrés, avec correction de la longitude) entre secteurs
 * consécutifs. Au moins trois secteurs localisés et 40° de rotation, sinon null.
 */
export function orientationAutourDepot(depot: { lat: number; lng: number }, centres: readonly { lat: number; lng: number }[]): Orientation | null {
  if (centres.length < 3) return null;
  const k = Math.cos((depot.lat * Math.PI) / 180);
  const angle = (p: { lat: number; lng: number }) => Math.atan2(p.lat - depot.lat, (p.lng - depot.lng) * k);
  let total = 0;
  for (let i = 1; i < centres.length; i++) {
    let d = angle(centres[i]!) - angle(centres[i - 1]!);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    total += d;
  }
  const degres = (total * 180) / Math.PI;
  if (Math.abs(degres) < 40) return null;
  return degres > 0 ? "antihoraire" : "horaire";
}

/** Texte de l'encart « Sens habituel » de l'écran d'optimisation. */
export function resumeHabitude(habitude: HabitudeSens, orientation: Orientation | null = null): string {
  const suite = `Sens habituel : ${libelleSens(habitude.ordre)}`;
  return orientation ? `${suite} (sens ${orientation === "horaire" ? "horaire" : "antihoraire"} autour du dépôt)` : suite;
}
