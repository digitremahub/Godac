/**
 * Planning (jours, congés, pré-remplissage, duplications) : logique pure
 * partagée entre l'écran (components/planning/Affectations.tsx, FenetresPlanning.tsx) et les
 * routes de duplication (app/api/planning/duplicate-week,
 * app/api/planning/entries/[id]/duplicate). Aucun accès réseau ni base :
 * testé dans lib/planning/__tests__/semaine.test.ts.
 *
 * Jours et heures sont ceux de Paris : une copie « même heure, autre jour »
 * repart de l'heure affichée (07:00) et non d'un décalage de 24 h, qui
 * glisserait d'une heure au passage heure d'été / heure d'hiver.
 */
import { addDays, parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { cleCreneau } from "@/lib/planning/cle-creneau";

export interface AffectationPlanning {
  id: string;
  service_id: string;
  tour_number: string;
  driver_id: string | null;
  vehicle_id: string | null;
  start_at: string;
  status: string;
}

export interface CongePlanning {
  driver_id: string;
  start_date: string;
  end_date: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Statuts : libellé et couleur de pastille (palette GODAC).
// ---------------------------------------------------------------------------

export const STATUTS_AFFECTATION: Record<string, { libelle: string; pastille: string; point: string }> = {
  planned: { libelle: "Prévue", pastille: "border-navy/20 bg-surface", point: "bg-navy/40" },
  in_progress: { libelle: "En cours", pastille: "border-gold bg-gold/20", point: "bg-gold" },
  done: { libelle: "Terminée", pastille: "border-teal/60 bg-teal/15", point: "bg-teal" },
  cancelled: { libelle: "Annulée", pastille: "border-orange/40 bg-orange/10 line-through opacity-70", point: "bg-orange" },
};

export function statutAffectation(status: string) {
  return STATUTS_AFFECTATION[status] ?? STATUTS_AFFECTATION.planned!;
}

/**
 * Seule une affectation encore « prévue » se déplace, se modifie ou se
 * supprime : PATCH/DELETE /api/planning/entries/[id] ne touchent que
 * status = 'planned' (une tournée démarrée ou terminée est figée).
 */
export function estModifiable(a: Pick<AffectationPlanning, "status">): boolean {
  return a.status === "planned";
}

// ---------------------------------------------------------------------------
// Jours et heures (Paris).
// ---------------------------------------------------------------------------

export const JOURS_COURTS = ["L", "M", "M", "J", "V", "S", "D"] as const;
export const JOURS_ABREGES = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."] as const;
export const JOURS_LONGS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

/** Jour (AAAA-MM-JJ) de Paris d'un instant. */
export const jourDe = (iso: string): string => parisCalendarDate(iso);

/** Heure « HH:MM » de Paris d'un instant. */
export function heureDe(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Les 7 jours (lundi → dimanche) d'une semaine. */
export function joursDeLaSemaine(lundi: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
}

/** Rang (0 = lundi … 6 = dimanche) d'une date quelconque. */
export function rangJour(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = dimanche
  return (d + 6) % 7;
}

/** « lun. 20/10 » */
export function libelleJour(date: string): string {
  return `${JOURS_ABREGES[rangJour(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Coche ou décoche un jour (rang 0…6) ; résultat trié, sans doublon. */
export function basculerRang(rangs: readonly number[], rang: number): number[] {
  const set = new Set(rangs.filter((r) => Number.isInteger(r) && r >= 0 && r <= 6));
  if (set.has(rang)) set.delete(rang);
  else if (Number.isInteger(rang) && rang >= 0 && rang <= 6) set.add(rang);
  return [...set].sort((a, b) => a - b);
}

/** Raccourci « jusqu'à la fin de la semaine » : les jours après le jour source. */
export function rangsJusquaFinDeSemaine(rangSource: number): number[] {
  if (rangSource < 0 || rangSource > 6) return [];
  return Array.from({ length: 6 - rangSource }, (_, i) => rangSource + 1 + i);
}

/** Dates des jours cochés, sans le jour source lui-même. */
export function datesCochees(lundi: string, rangs: readonly number[], exclure?: string): string[] {
  return [...new Set(rangs)]
    .filter((r) => r >= 0 && r <= 6)
    .sort((a, b) => a - b)
    .map((r) => addDays(lundi, r))
    .filter((d) => d !== exclure);
}

// ---------------------------------------------------------------------------
// Grille : lignes chauffeurs, cases, congés.
// ---------------------------------------------------------------------------

/** Clé d'une case : chauffeur (ou « aucun ») + jour. */
export const AUCUN_CHAUFFEUR = "aucun";
export function cleCase(driverId: string | null, date: string): string {
  return `${driverId ?? AUCUN_CHAUFFEUR}|${date}`;
}

/** Affectations rangées par case, triées par heure. */
export function affectationsParCase<T extends AffectationPlanning>(affectations: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const a of affectations) {
    const k = cleCase(a.driver_id, jourDe(a.start_at));
    const liste = m.get(k) ?? [];
    liste.push(a);
    m.set(k, liste);
  }
  for (const liste of m.values()) liste.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return m;
}

/**
 * Chauffeurs à afficher en lignes : ceux rattachés aux services filtrés,
 * plus ceux qui ont déjà une affectation affichée (un remplaçant d'un autre
 * service reste visible). Sans information de rattachement : tous.
 */
export function chauffeursAffiches<D extends { id: string; full_name: string }>(
  chauffeurs: readonly D[],
  rattachements: readonly { user_id: string; service_id: string }[] | null,
  serviceIds: readonly string[],
  affectations: readonly Pick<AffectationPlanning, "driver_id">[],
): D[] {
  const tri = (l: D[]) => l.sort((a, b) => a.full_name.localeCompare(b.full_name, "fr"));
  if (!rattachements || rattachements.length === 0) return tri([...chauffeurs]);
  const services = new Set(serviceIds);
  const ids = new Set<string>();
  for (const r of rattachements) if (services.has(r.service_id)) ids.add(r.user_id);
  for (const a of affectations) if (a.driver_id) ids.add(a.driver_id);
  return tri(chauffeurs.filter((c) => ids.has(c.id)));
}

/** Congé du chauffeur ce jour-là : validé, demandé (en attente) ou aucun. */
export function congeDuJour(driverId: string, date: string, conges: readonly CongePlanning[]): "approved" | "pending" | null {
  let trouve: "approved" | "pending" | null = null;
  for (const c of conges) {
    if (c.driver_id !== driverId || date < c.start_date || date > c.end_date) continue;
    if (c.status === "approved") return "approved";
    if (c.status === "pending") trouve = "pending";
  }
  return trouve;
}

// ---------------------------------------------------------------------------
// Conflits (avertissements, jamais bloquants).
// ---------------------------------------------------------------------------

const STATUTS_OCCUPES = new Set(["planned", "in_progress"]);

/**
 * Avertissements pour une affectation (nouvelle ou modifiée) : même
 * chauffeur déjà pris à la même heure, véhicule déjà pris à la même
 * heure, congé validé ou demandé. Ne bloque rien : l'encadrement décide.
 */
export function conflitsAffectation(
  cible: { driverId: string | null; vehicleId?: string | null; date: string; heure: string; ignorerId?: string | null },
  affectations: readonly AffectationPlanning[],
  conges: readonly CongePlanning[] = [],
): string[] {
  const out: string[] = [];
  if (!cible.date || !/^\d{2}:\d{2}$/.test(cible.heure)) return out;
  const instant = Date.parse(parisWallTimeToUtcISOString(cible.date, cible.heure));
  const memeInstant = affectations.filter((a) => a.id !== cible.ignorerId && STATUTS_OCCUPES.has(a.status) && Date.parse(a.start_at) === instant);
  if (cible.driverId) {
    const pris = memeInstant.filter((a) => a.driver_id === cible.driverId);
    if (pris.length) out.push(`Chauffeur déjà affecté à ${cible.heure} : ${pris.map((a) => `n°${a.tour_number}`).join(", ")}.`);
    const conge = congeDuJour(cible.driverId, cible.date, conges);
    if (conge === "approved") out.push("Chauffeur en congé ce jour-là.");
    else if (conge === "pending") out.push("Congé demandé ce jour-là (en attente de réponse).");
  }
  if (cible.vehicleId) {
    const pris = memeInstant.filter((a) => a.vehicle_id === cible.vehicleId && a.driver_id !== cible.driverId);
    if (pris.length) out.push(`Véhicule déjà utilisé à ${cible.heure} : ${pris.map((a) => `n°${a.tour_number}`).join(", ")}.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pré-remplissage heure / véhicule du formulaire « Ajouter ».
// ---------------------------------------------------------------------------

export interface ModelePlanning {
  service_id: string;
  tour_number: string;
  departure_time: string; // « 07:00:00 » ou « 07:00 »
  weekdays: number[]; // 0 = dimanche … 6 = samedi
  default_vehicle_id: string | null;
}

export interface VehiculePlanning {
  id: string;
  service_id: string | null;
  assigned_driver_id?: string | null;
}

export type OriginePreRemplissage = "historique" | "modele" | "vehicule" | "defaut";

export const LIBELLE_ORIGINE: Record<OriginePreRemplissage, string> = {
  historique: "repris de sa dernière affectation sur cette tournée",
  modele: "repris du modèle de la tournée",
  vehicule: "véhicule attribué au chauffeur",
  defaut: "",
};

/**
 * Heure et véhicule proposés, dans l'ordre :
 * 1. dernière affectation du même chauffeur sur cette tournée (et ce service) ;
 * 2. modèle de la tournée (jour de la semaine correspondant en priorité) ;
 * 3. véhicule attribué au chauffeur (fiche véhicule), heure 07:00.
 * Un véhicule manquant à une étape est complété par l'étape suivante.
 */
export function preRemplir(
  cible: { driverId: string | null; serviceId: string; tourNumber: string; date: string },
  sources: { historique: readonly AffectationPlanning[]; modeles: readonly ModelePlanning[]; vehicules: readonly VehiculePlanning[] },
): { heure: string; vehiculeId: string; origine: OriginePreRemplissage } {
  let heure: string | null = null;
  let vehiculeId: string | null = null;
  let origine: OriginePreRemplissage = "defaut";

  if (cible.driverId && cible.tourNumber) {
    const derniere = sources.historique
      .filter((a) => a.driver_id === cible.driverId && a.tour_number === cible.tourNumber && a.service_id === cible.serviceId && a.status !== "cancelled")
      .sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at))[0];
    if (derniere) {
      heure = heureDe(derniere.start_at);
      vehiculeId = derniere.vehicle_id;
      origine = "historique";
    }
  }

  if (!heure && cible.tourNumber) {
    const jourSemaine = new Date(`${cible.date}T12:00:00Z`).getUTCDay();
    const candidats = sources.modeles.filter((m) => m.service_id === cible.serviceId && m.tour_number === cible.tourNumber);
    const modele = candidats.find((m) => m.weekdays.includes(jourSemaine)) ?? candidats[0];
    if (modele) {
      heure = modele.departure_time.slice(0, 5);
      vehiculeId = modele.default_vehicle_id;
      origine = "modele";
    }
  }

  if (!vehiculeId && cible.driverId) {
    const attribues = sources.vehicules.filter((v) => v.assigned_driver_id === cible.driverId);
    const attribue = attribues.find((v) => v.service_id === cible.serviceId) ?? attribues[0];
    if (attribue) {
      vehiculeId = attribue.id;
      if (origine === "defaut") origine = "vehicule";
    }
  }

  return { heure: heure ?? "07:00", vehiculeId: vehiculeId ?? "", origine };
}

// ---------------------------------------------------------------------------
// Duplications : calcul des copies, créneaux ignorés, conflits.
// ---------------------------------------------------------------------------

export interface CopieDemandee {
  source: AffectationPlanning;
  date: string;
  /** Autre chauffeur (copier / coller vers la ligne d'un autre chauffeur). */
  driverId?: string | null;
  vehicleId?: string | null;
}

export interface NouvelleAffectation {
  service_id: string;
  tour_number: string;
  driver_id: string | null;
  vehicle_id: string | null;
  start_at: string;
  sourceId: string;
}

export interface PlanDeCopie {
  aCreer: NouvelleAffectation[];
  /** Créneau (service, tournée, départ) déjà occupé : rien n'est créé. */
  ignorees: CopieDemandee[];
  /** Créées quand même, mais chauffeur déjà pris à la même heure. */
  conflits: NouvelleAffectation[];
  /**
   * Créées SANS chauffeur : le chauffeur recopié est absent ce jour-là
   * (congé validé, arrêt de travail). La case reste « à remplacer ».
   */
  aRemplacer: NouvelleAffectation[];
}

/** Chaque source copiée vers chaque date (même heure de Paris). */
export function copiesVersDates(sources: readonly AffectationPlanning[], dates: readonly string[], surcharge: { driverId?: string | null; vehicleId?: string | null } = {}): CopieDemandee[] {
  const out: CopieDemandee[] = [];
  for (const source of sources) for (const date of dates) out.push({ source, date, ...surcharge });
  return out;
}

/** Semaine source recopiée sur les N semaines suivantes (1 à 8), jour pour jour. */
export function copiesSurSemaines(sources: readonly AffectationPlanning[], nbSemaines: number): CopieDemandee[] {
  const n = Math.max(1, Math.min(8, Math.trunc(nbSemaines)));
  const out: CopieDemandee[] = [];
  for (let k = 1; k <= n; k++) for (const source of sources) out.push({ source, date: addDays(jourDe(source.start_at), 7 * k) });
  return out;
}

/** Affectations copiables : ni présence bureau, ni annulée, avec chauffeur et véhicule. */
export function estCopiable(a: AffectationPlanning): boolean {
  return a.status !== "presence" && a.status !== "cancelled" && !a.tour_number.startsWith("PRESENCE-") && Boolean(a.driver_id) && Boolean(a.vehicle_id);
}

/**
 * Plan de copie : ce qui sera créé, ce qui est ignoré (créneau unique
 * service + tournée + départ déjà pris, en base ou plus tôt dans le même
 * plan) et ce qui sera créé en conflit (chauffeur déjà pris à cette heure).
 * Même règle que la contrainte unique de planning_entries.
 *
 * `absent(chauffeur, jour)` : chauffeur en congé validé ou en arrêt ce
 * jour-là (lib/planning/affectation.ts › estAbsent). Il n'est pas placé :
 * l'affectation est créée sans chauffeur, « à remplacer ».
 */
export function planifierCopies(
  demandes: readonly CopieDemandee[],
  existantes: readonly AffectationPlanning[],
  options: { absent?: (driverId: string, date: string) => boolean } = {},
): PlanDeCopie {
  const occupes = new Set(existantes.filter((e) => e.status !== "cancelled").map((e) => cleCreneau(e.service_id, e.tour_number, e.start_at)));
  const chauffeurs = new Set(existantes.filter((e) => e.driver_id && STATUTS_OCCUPES.has(e.status)).map((e) => `${e.driver_id}|${Date.parse(e.start_at)}`));
  const plan: PlanDeCopie = { aCreer: [], ignorees: [], conflits: [], aRemplacer: [] };

  for (const d of demandes) {
    const startAt = parisWallTimeToUtcISOString(d.date, heureDe(d.source.start_at));
    const cle = cleCreneau(d.source.service_id, d.source.tour_number, startAt);
    if (occupes.has(cle)) {
      plan.ignorees.push(d);
      continue;
    }
    occupes.add(cle);
    const voulu = d.driverId !== undefined && d.driverId !== null ? d.driverId : d.source.driver_id;
    const absent = Boolean(voulu && options.absent?.(voulu, d.date));
    const driverId = absent ? null : voulu;
    const vehicleId = d.vehicleId !== undefined && d.vehicleId !== null && d.vehicleId !== "" ? d.vehicleId : d.source.vehicle_id;
    const ligne: NouvelleAffectation = { service_id: d.source.service_id, tour_number: d.source.tour_number, driver_id: driverId, vehicle_id: vehicleId, start_at: startAt, sourceId: d.source.id };
    plan.aCreer.push(ligne);
    if (absent) plan.aRemplacer.push(ligne);
    if (driverId) {
      const cleChauffeur = `${driverId}|${Date.parse(startAt)}`;
      if (chauffeurs.has(cleChauffeur)) plan.conflits.push(ligne);
      chauffeurs.add(cleChauffeur);
    }
  }
  return plan;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** « 42 affectations seront créées, 3 créneaux déjà occupés ignorés, 1 en conflit, 2 à remplacer (chauffeur absent) » */
export function texteApercu(r: { creees: number; ignorees: number; conflits: number; aRemplacer?: number }): string {
  const parts = [`${pluriel(r.creees, "affectation sera créée", "affectations seront créées")}`];
  if (r.ignorees) parts.push(pluriel(r.ignorees, "créneau déjà occupé ignoré", "créneaux déjà occupés ignorés"));
  if (r.conflits) parts.push(`${r.conflits} en conflit (chauffeur déjà pris à la même heure)`);
  if (r.aRemplacer) parts.push(`${r.aRemplacer} à remplacer (chauffeur en congé ou en arrêt ce jour-là)`);
  return parts.join(", ");
}

/** « 3 créées, 1 ignorée (déjà occupée), 0 en conflit » (+ « 1 à remplacer (absent) ») */
export function texteResultat(r: { creees: number; ignorees: number; conflits: number; aRemplacer?: number }): string {
  const base = `${pluriel(r.creees, "créée", "créées")}, ${pluriel(r.ignorees, "ignorée", "ignorées")} (déjà occupée${r.ignorees > 1 ? "s" : ""}), ${r.conflits} en conflit`;
  return r.aRemplacer ? `${base}, ${r.aRemplacer} à remplacer (absent)` : base;
}

/** Additionne des résultats partiels (une requête par affectation copiée). */
export function cumulerResultats(rs: readonly { creees?: number; ignorees?: number; conflits?: number; aRemplacer?: number }[]): { creees: number; ignorees: number; conflits: number; aRemplacer: number } {
  return rs.reduce<{ creees: number; ignorees: number; conflits: number; aRemplacer: number }>(
    (t, r) => ({ creees: t.creees + (r.creees ?? 0), ignorees: t.ignorees + (r.ignorees ?? 0), conflits: t.conflits + (r.conflits ?? 0), aRemplacer: t.aRemplacer + (r.aRemplacer ?? 0) }),
    { creees: 0, ignorees: 0, conflits: 0, aRemplacer: 0 },
  );
}
