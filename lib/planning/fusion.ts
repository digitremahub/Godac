/**
 * Tournées FUSIONNÉES du lundi (logique pure, testée dans
 * __tests__/fusion.test.ts).
 *
 * Contexte métier : le lundi, plusieurs tournées sont regroupées en une seule
 * ligne de planning (les villages de plusieurs tournées et leurs ramasses sont
 * rassemblés) et on ne sait pas encore quelle tournée réelle fera quoi.
 *
 * Modèle (migration 20261105000001) :
 * - la ligne de planning fusionnée liste ses tournées d'origine
 *   (planning_entry_merged_routes → tour_routes) ;
 * - ses ÉLÉMENTS à répartir sont les villages de ces tournées
 *   (tour_route_villages) et les ramasses de ces villages (planned_stops de
 *   type ramasse, pickup_addresses) ;
 * - chaque élément est « À attribuer » (aucune ligne de répartition) ou
 *   attribué à un chauffeur et/ou à une tournée réelle, à titre PROVISOIRE ;
 * - les tournées réelles (fiches Tournée colis des chauffeurs) fixent ensuite
 *   ce qui a réellement été desservi : la réconciliation compare le prévu au
 *   réel, propose les corrections et les applique (statut « confirme »).
 */
import { cleCommune } from "@/lib/colis/villages";

export type KindElement = "village" | "ramasse";
export type StatutRepartition = "provisoire" | "confirme";
export type EtatElement = "a_attribuer" | StatutRepartition;

export interface RouteOrigine {
  id: string;
  tour_number: string;
}

/** Village d'une tournée d'origine (colonnes de tour_route_villages). */
export interface VillageOrigine {
  id: string;
  name: string;
  route_id: string;
  position?: number | null;
  postal_code?: string | null;
  planned_stops?: unknown;
  pickup_addresses?: unknown;
}

export interface ElementFusion {
  kind: KindElement;
  /** Village : son identifiant. Ramasse : « ramasse: » + adresse normalisée. */
  cle: string;
  label: string;
  /** Village qui porte l'élément (le village lui-même, ou celui de la ramasse). */
  villageId: string;
  /** Tournée d'origine du village. */
  routeId: string;
}

export interface LigneRepartition {
  kind: KindElement;
  element_key: string;
  element_label: string;
  driver_id: string | null;
  route_id: string | null;
  statut: StatutRepartition;
}

export interface Attribution {
  kind: KindElement;
  cle: string;
  label: string;
  driver_id: string | null;
  route_id: string | null;
}

/**
 * Clé d'une ramasse : même normalisation que cleAdresse (lib/colis/serveur.ts,
 * qui est réservé au serveur) pour retrouver la ramasse dans les arrêts des
 * fiches (delivery_stops.address).
 */
export function cleRamasse(adresse: string): string {
  const n = adresse
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `ramasse:${n}`;
}

const ADRESSE_MIN = 5;

/** Ramasses d'un village : planned_stops (hors points relais) et pickup_addresses, sans doublon. */
export function ramassesDuVillage(v: Pick<VillageOrigine, "planned_stops" | "pickup_addresses">): { cle: string; adresse: string }[] {
  const planifiees = (Array.isArray(v.planned_stops) ? v.planned_stops : [])
    .filter((s): s is { address: string; type?: string } => Boolean(s) && typeof (s as { address?: unknown }).address === "string" && (s as { type?: string }).type !== "point_relais")
    .map((s) => s.address.trim());
  const anciennes = (Array.isArray(v.pickup_addresses) ? v.pickup_addresses : []).filter((a): a is string => typeof a === "string").map((a) => a.trim());
  const vues = new Set<string>();
  const out: { cle: string; adresse: string }[] = [];
  for (const adresse of [...planifiees, ...anciennes]) {
    if (adresse.length < ADRESSE_MIN) continue;
    const cle = cleRamasse(adresse);
    if (vues.has(cle)) continue;
    vues.add(cle);
    out.push({ cle, adresse });
  }
  return out;
}

/**
 * Éléments à répartir : villages des tournées d'origine (un village qui figure
 * dans deux tournées d'origine n'est compté qu'une fois, le premier garde
 * la main) puis leurs ramasses.
 */
export function elementsDeFusion(villages: readonly VillageOrigine[], routes: readonly RouteOrigine[] = []): { villages: ElementFusion[]; ramasses: ElementFusion[] } {
  const ordreRoute = new Map(routes.map((r, i) => [r.id, i]));
  const tries = [...villages].sort(
    (a, b) => (ordreRoute.get(a.route_id) ?? 999) - (ordreRoute.get(b.route_id) ?? 999) || (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "fr"),
  );
  const vus = new Set<string>();
  const out = { villages: [] as ElementFusion[], ramasses: [] as ElementFusion[] };
  const ramassesVues = new Set<string>();
  for (const v of tries) {
    const nom = cleCommune(v.name);
    if (!nom || vus.has(nom)) continue;
    vus.add(nom);
    out.villages.push({ kind: "village", cle: v.id, label: v.name, villageId: v.id, routeId: v.route_id });
    for (const r of ramassesDuVillage(v)) {
      if (ramassesVues.has(r.cle)) continue;
      ramassesVues.add(r.cle);
      out.ramasses.push({ kind: "ramasse", cle: r.cle, label: r.adresse, villageId: v.id, routeId: v.route_id });
    }
  }
  return out;
}

const cleLigne = (kind: KindElement, cle: string) => `${kind}:${cle}`;

/** Lignes de répartition indexées par type + clé. */
export function indexerRepartition(lignes: readonly LigneRepartition[]): Map<string, LigneRepartition> {
  return new Map(lignes.map((l) => [cleLigne(l.kind, l.element_key), l]));
}

/** Une ligne sans chauffeur ni tournée n'attribue rien : l'élément reste « À attribuer ». */
export const estAttribuee = (l: Pick<LigneRepartition, "driver_id" | "route_id"> | undefined | null): boolean => Boolean(l && (l.driver_id || l.route_id));

export function etatElement(e: Pick<ElementFusion, "kind" | "cle">, index: Map<string, LigneRepartition>): EtatElement {
  const l = index.get(cleLigne(e.kind, e.cle));
  return estAttribuee(l) ? l!.statut : "a_attribuer";
}

export interface ResumeRepartition {
  total: number;
  aAttribuer: number;
  provisoires: number;
  confirmes: number;
  villagesAAttribuer: number;
  ramassesAAttribuer: number;
}

export function resumeRepartition(elements: readonly ElementFusion[], lignes: readonly LigneRepartition[]): ResumeRepartition {
  const index = indexerRepartition(lignes);
  const r: ResumeRepartition = { total: elements.length, aAttribuer: 0, provisoires: 0, confirmes: 0, villagesAAttribuer: 0, ramassesAAttribuer: 0 };
  for (const e of elements) {
    const etat = etatElement(e, index);
    if (etat === "a_attribuer") {
      r.aAttribuer++;
      if (e.kind === "village") r.villagesAAttribuer++;
      else r.ramassesAAttribuer++;
    } else if (etat === "provisoire") r.provisoires++;
    else r.confirmes++;
  }
  return r;
}

/** « 3 villages et 2 ramasses à attribuer » */
export function texteAAttribuer(r: Pick<ResumeRepartition, "villagesAAttribuer" | "ramassesAAttribuer">): string {
  const parts: string[] = [];
  if (r.villagesAAttribuer) parts.push(`${r.villagesAAttribuer} village${r.villagesAAttribuer > 1 ? "s" : ""}`);
  if (r.ramassesAAttribuer) parts.push(`${r.ramassesAAttribuer} ramasse${r.ramassesAAttribuer > 1 ? "s" : ""}`);
  return parts.length ? `${parts.join(" et ")} à attribuer` : "Tout est attribué";
}

export interface ChangementRepartition {
  /** Lignes à écrire (insertion ou remplacement). */
  ecrire: LigneRepartition[];
  /** Éléments redevenus « À attribuer » : leur ligne est supprimée. */
  supprimer: { kind: KindElement; element_key: string }[];
}

/**
 * Applique des attributions : chauffeur et/ou tournée = attribué (PROVISOIRE),
 * les deux vides = retour à « À attribuer ». Les éléments inconnus de la
 * fusion sont ignorés (un client ne répartit que ce que la fusion contient).
 */
export function appliquerAttributions(
  elements: readonly ElementFusion[],
  lignes: readonly LigneRepartition[],
  attributions: readonly Attribution[],
): ChangementRepartition {
  const connus = new Map(elements.map((e) => [cleLigne(e.kind, e.cle), e]));
  const index = indexerRepartition(lignes);
  const ecrire = new Map<string, LigneRepartition>();
  const supprimer: ChangementRepartition["supprimer"] = [];
  for (const a of attributions) {
    const cle = cleLigne(a.kind, a.cle);
    const element = connus.get(cle);
    if (!element) continue;
    if (!a.driver_id && !a.route_id) {
      ecrire.delete(cle);
      if (index.has(cle) && !supprimer.some((s) => s.kind === a.kind && s.element_key === a.cle)) supprimer.push({ kind: a.kind, element_key: a.cle });
      continue;
    }
    const avant = index.get(cle);
    // Même cible qu'avant : on garde son statut (une ligne confirmée par le réel le reste).
    const identique = avant && avant.driver_id === a.driver_id && avant.route_id === a.route_id;
    ecrire.set(cle, { kind: a.kind, element_key: a.cle, element_label: element.label, driver_id: a.driver_id, route_id: a.route_id, statut: identique ? avant.statut : "provisoire" });
  }
  const retires = new Set(supprimer.map((s) => cleLigne(s.kind, s.element_key)));
  return { ecrire: [...ecrire.values()].filter((l) => !retires.has(cleLigne(l.kind, l.element_key))), supprimer };
}

/** Répartition entièrement donnée à un chauffeur (raccourci « tout à … »). */
export function toutAttribuer(elements: readonly ElementFusion[], driverId: string | null, routeId: string | null = null): Attribution[] {
  return elements.map((e) => ({ kind: e.kind, cle: e.cle, label: e.label, driver_id: driverId, route_id: routeId }));
}

// ---------------------------------------------------------------------------
// Fiche colis du chauffeur : ce qu'il voit.
// ---------------------------------------------------------------------------

/**
 * Un élément est visible pour ce chauffeur s'il lui est attribué ou s'il
 * est encore « À attribuer » (aucun chauffeur choisi : tous les chauffeurs de
 * la fusion le voient, comme avant la répartition, rien ne se perd). Une
 * tournée réelle choisie sans chauffeur ne retire rien non plus.
 */
export function estVisiblePour(driverId: string, ligne: Pick<LigneRepartition, "driver_id"> | undefined | null): boolean {
  return !ligne || !ligne.driver_id || ligne.driver_id === driverId;
}

export interface VisibleDuChauffeur {
  /** Identifiants (éléments de la fusion) des villages à charger sur sa fiche. */
  villageIds: Set<string>;
  /** Clés des ramasses à charger sur sa fiche. */
  ramasseCles: Set<string>;
}

/**
 * Villages et ramasses de la fiche d'un chauffeur.
 * - village : le sien, ou « À attribuer » ;
 * - ramasse attribuée à un chauffeur : à lui seul (son village est chargé
 *   pour la porter, même attribué à un autre) ;
 * - ramasse « À attribuer » : elle suit son village (visible par qui voit le
 *   village), pour ne jamais se perdre.
 */
export function visiblesPour(driverId: string, elements: { villages: readonly ElementFusion[]; ramasses: readonly ElementFusion[] }, lignes: readonly LigneRepartition[]): VisibleDuChauffeur {
  const index = indexerRepartition(lignes);
  const villageIds = new Set(elements.villages.filter((v) => estVisiblePour(driverId, index.get(cleLigne("village", v.cle)))).map((v) => v.cle));
  const ramasseCles = new Set<string>();
  for (const r of elements.ramasses) {
    const propre = index.get(cleLigne("ramasse", r.cle));
    const visible = propre?.driver_id ? propre.driver_id === driverId : villageIds.has(r.villageId);
    if (!visible) continue;
    ramasseCles.add(r.cle);
    if (propre?.driver_id === driverId) villageIds.add(r.villageId);
  }
  return { villageIds, ramasseCles };
}

/** Élément de la fusion qui correspond à un village (même identifiant, sinon même nom de commune). */
export function elementDuVillage(v: { id: string; name: string }, villages: readonly ElementFusion[]): ElementFusion | null {
  return villages.find((x) => x.cle === v.id) ?? villages.find((x) => cleCommune(x.label) === cleCommune(v.name)) ?? null;
}

// ---------------------------------------------------------------------------
// Réconciliation prévu / réel.
// ---------------------------------------------------------------------------

/** Ce qu'un chauffeur a réellement sur sa fiche Tournée colis du jour. */
export interface ReelChauffeur {
  driverId: string;
  /** Villages réellement desservis (au moins un arrêt de livraison dans leur liste). */
  villageIds: string[];
  /** Ramasses présentes sur sa fiche ; `faite` : arrêt terminé. */
  ramasses: { cle: string; faite: boolean }[];
}

export type NatureEcart =
  /** Le chauffeur prévu est bien celui qui l'a fait / l'a sur sa fiche. */
  | "conforme"
  /** Rien n'était attribué ; un seul chauffeur l'a. */
  | "a_attribuer_resolu"
  /** Attribué à quelqu'un d'autre que le chauffeur qui l'a réellement. */
  | "autre_chauffeur"
  /** Plusieurs chauffeurs l'ont : à corriger à la main. */
  | "plusieurs_chauffeurs"
  /** Personne ne l'a (pas encore de fiche, ou village non desservi). */
  | "non_realise";

export interface EcartFusion {
  kind: KindElement;
  cle: string;
  label: string;
  prevu: string | null;
  etatPrevu: EtatElement;
  reel: string[];
  faite: boolean | null;
  nature: NatureEcart;
}

export interface Reconciliation {
  ecarts: EcartFusion[];
  /** Attributions à appliquer pour aligner la répartition sur le réel. */
  propositions: Attribution[];
  resume: { conformes: number; resolus: number; autres: number; plusieurs: number; nonRealises: number; aConfirmer: number };
}

/**
 * Compare la répartition PRÉVUE (provisoire) au RÉEL (fiches des chauffeurs).
 * Seul le réel d'un chauffeur unique corrige : s'il y en a plusieurs, ou
 * aucun, rien n'est proposé (correction à la main). Un élément déjà confirmé
 * et conforme ne propose rien.
 */
export function reconcilier(elements: readonly ElementFusion[], lignes: readonly LigneRepartition[], reel: readonly ReelChauffeur[]): Reconciliation {
  const index = indexerRepartition(lignes);
  const ecarts: EcartFusion[] = [];
  const propositions: Attribution[] = [];
  const resume = { conformes: 0, resolus: 0, autres: 0, plusieurs: 0, nonRealises: 0, aConfirmer: 0 };

  for (const e of elements) {
    const ligne = index.get(cleLigne(e.kind, e.cle));
    const prevu = estAttribuee(ligne) ? (ligne!.driver_id ?? null) : null;
    const etatPrevu = etatElement(e, index);
    const pris = reel.filter((r) => (e.kind === "village" ? r.villageIds.includes(e.cle) : r.ramasses.some((x) => x.cle === e.cle)));
    const chauffeurs = [...new Set(pris.map((r) => r.driverId))];
    const faite = e.kind === "ramasse" && pris.length ? pris.some((r) => r.ramasses.some((x) => x.cle === e.cle && x.faite)) : null;
    const base = { kind: e.kind, cle: e.cle, label: e.label, prevu, etatPrevu, reel: chauffeurs, faite };
    const proposer = () => propositions.push({ kind: e.kind, cle: e.cle, label: e.label, driver_id: chauffeurs[0]!, route_id: ligne?.route_id ?? null });

    if (chauffeurs.length === 0) {
      resume.nonRealises++;
      ecarts.push({ ...base, nature: "non_realise" });
    } else if (chauffeurs.length > 1) {
      resume.plusieurs++;
      ecarts.push({ ...base, nature: "plusieurs_chauffeurs" });
    } else if (prevu === chauffeurs[0]) {
      resume.conformes++;
      if (etatPrevu === "provisoire") {
        resume.aConfirmer++;
        proposer();
      }
      ecarts.push({ ...base, nature: "conforme" });
    } else if (!prevu) {
      resume.resolus++;
      proposer();
      ecarts.push({ ...base, nature: "a_attribuer_resolu" });
    } else {
      resume.autres++;
      proposer();
      ecarts.push({ ...base, nature: "autre_chauffeur" });
    }
  }
  return { ecarts, propositions, resume };
}

export const LIBELLE_NATURE: Record<NatureEcart, string> = {
  conforme: "Conforme au prévu",
  a_attribuer_resolu: "Était à attribuer",
  autre_chauffeur: "Fait par un autre chauffeur",
  plusieurs_chauffeurs: "Sur plusieurs fiches",
  non_realise: "Pas encore sur une fiche",
};

/** « 8 conformes, 2 écarts (1 autre chauffeur, 1 était à attribuer), 3 pas encore sur une fiche » */
export function texteReconciliation(r: Reconciliation["resume"]): string {
  const ecarts = r.resolus + r.autres + r.plusieurs;
  const parts: string[] = [];
  if (r.conformes) parts.push(`${r.conformes} conforme${r.conformes > 1 ? "s" : ""}`);
  if (ecarts) {
    const detail = [r.autres ? `${r.autres} autre chauffeur` : null, r.resolus ? `${r.resolus} ${r.resolus > 1 ? "étaient" : "était"} à attribuer` : null, r.plusieurs ? `${r.plusieurs} sur plusieurs fiches` : null].filter(Boolean);
    parts.push(`${ecarts} écart${ecarts > 1 ? "s" : ""} (${detail.join(", ")})`);
  }
  if (r.nonRealises) parts.push(`${r.nonRealises} pas encore sur une fiche`);
  return parts.join(", ") || "Rien à comparer";
}

/**
 * Applique les propositions : le réel fait foi, la ligne devient « confirmée »
 * pour ce chauffeur (la tournée réelle déjà choisie est conservée).
 */
export function appliquerReconciliation(elements: readonly ElementFusion[], lignes: readonly LigneRepartition[], propositions: readonly Attribution[]): LigneRepartition[] {
  const index = indexerRepartition(lignes);
  const connus = new Map(elements.map((e) => [cleLigne(e.kind, e.cle), e]));
  const out: LigneRepartition[] = [];
  for (const p of propositions) {
    const e = connus.get(cleLigne(p.kind, p.cle));
    if (!e || !p.driver_id) continue;
    const avant = index.get(cleLigne(p.kind, p.cle));
    out.push({ kind: p.kind, element_key: p.cle, element_label: e.label, driver_id: p.driver_id, route_id: avant?.route_id ?? p.route_id, statut: "confirme" });
  }
  return out;
}
