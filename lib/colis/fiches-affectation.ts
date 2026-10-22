/**
 * Fiches Tournée colis ↔ affectations du planning (logique pure, testée
 * dans __tests__/fiches-affectation.test.ts).
 *
 * Modèle (migration 20261023000002) :
 * - `planning_entries.delivery_run_id` : la fiche colis qui porte cette
 *   affectation (villages, ramasses, points relais chargés dessus). Une
 *   entrée n'est portée que par une seule fiche : jamais rechargée ailleurs.
 * - Fiche « séparée » (cas normal) : une fiche par affectation, créée avec
 *   `delivery_runs.planning_entry_id` = l'entrée et `fiche_planifiee` = true.
 * - Fiche « reliée » (exceptionnel) : plusieurs entrées portent la même fiche.
 * - Fiche « libre » (`fiche_planifiee` = false) : créée par le chauffeur sans
 *   planning ; une seule ouverte par chauffeur et par jour (index unique
 *   delivery_runs_driver_open_day_libre_uidx, contre le double clic). Elle
 *   peut aussi porter des entrées reliées.
 */

export type Regroupement = "separee" | "reliee";

export interface EntreeDuJour {
  id: string;
  tour_number: string | null;
  start_at: string;
  status: string;
  created_at: string;
  delivery_run_id: string | null;
}

export interface FicheDuJour {
  id: string;
  name: string | null;
  status: string;
  created_at: string;
  planning_entry_id: string | null;
  fiche_planifiee: boolean;
}

/** Jour de Paris (AAAA-MM-JJ) d'un instant. */
export const jourParis = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));

/** Heure de Paris (HH:MM) d'un instant. */
export const heureParis = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** Affectations réelles du jour : numéro de tournée, non annulées, ce jour-là à Paris, triées par heure. */
export function entreesDuJour<T extends Pick<EntreeDuJour, "tour_number" | "start_at" | "status">>(entrees: T[], date: string): T[] {
  return entrees
    .filter((e) => Boolean(e.tour_number) && e.status !== "cancelled" && jourParis(e.start_at) === date)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
}

/** Entrées portées par une fiche (séparée : une ; reliée : plusieurs ; libre : celles qu'on y a reliées). */
export function entreesDeLaFiche<T extends Pick<EntreeDuJour, "id" | "delivery_run_id">>(fiche: Pick<FicheDuJour, "id" | "planning_entry_id">, entrees: T[]): T[] {
  return entrees.filter((e) => e.delivery_run_id === fiche.id || (fiche.planning_entry_id !== null && e.id === fiche.planning_entry_id));
}

/** Date de création de la dernière fiche libre clôturée du jour (avant elle, les entrées orphelines y ont été chargées, ancien fonctionnement). */
export function derniereLibreCloturee(fiches: FicheDuJour[]): string | null {
  return fiches
    .filter((f) => f.status === "done" && !f.fiche_planifiee)
    .map((f) => f.created_at)
    .sort()
    .at(-1) ?? null;
}

/**
 * Entrées du jour qu'aucune fiche ne porte encore (ni par `delivery_run_id`
 * ni comme entrée d'origine d'une fiche séparée), inscrites après la
 * dernière fiche libre clôturée. Seulement les tournées encore à faire
 * (prévues ou en cours).
 */
export function entreesOrphelines<T extends EntreeDuJour>(entrees: T[], fiches: FicheDuJour[]): T[] {
  const ids = new Set(fiches.map((f) => f.id));
  const origines = new Set(fiches.map((f) => f.planning_entry_id).filter(Boolean));
  const apres = derniereLibreCloturee(fiches);
  return entrees.filter(
    (e) => ["planned", "in_progress"].includes(e.status) && !(e.delivery_run_id && ids.has(e.delivery_run_id)) && !origines.has(e.id) && (!apres || Date.parse(e.created_at) > Date.parse(apres)),
  );
}

export interface ChoixRequis {
  requis: boolean;
  existantes: { tour_number: string; heure: string }[];
  fiches_ouvertes: { id: string; name: string | null }[];
}

/**
 * Faut-il demander « séparées ou reliées » avant d'affecter une tournée ?
 * Oui si le chauffeur a déjà ce jour-là une autre affectation encore à faire
 * (non portée par une fiche clôturée) ou une fiche colis ouverte.
 */
export function choixRequis(autresEntrees: EntreeDuJour[], fiches: FicheDuJour[]): ChoixRequis {
  const cloturees = new Set(fiches.filter((f) => f.status === "done").map((f) => f.id));
  const origineCloturee = new Set(fiches.filter((f) => f.status === "done").map((f) => f.planning_entry_id).filter(Boolean));
  const apres = derniereLibreCloturee(fiches);
  const encore = autresEntrees.filter((e) => {
    if (e.status === "done" || e.status === "cancelled") return false;
    if (e.delivery_run_id && cloturees.has(e.delivery_run_id)) return false;
    if (origineCloturee.has(e.id)) return false;
    // Ancien fonctionnement : orpheline antérieure à une fiche libre clôturée = déjà faite.
    if (!e.delivery_run_id && apres && Date.parse(e.created_at) <= Date.parse(apres)) return false;
    return true;
  });
  const ouvertes = fiches.filter((f) => f.status !== "done");
  return {
    requis: encore.length > 0 || ouvertes.length > 0,
    existantes: encore.map((e) => ({ tour_number: String(e.tour_number), heure: heureParis(e.start_at) })),
    fiches_ouvertes: ouvertes.map((f) => ({ id: f.id, name: f.name })),
  };
}

/**
 * Fiche ouverte à laquelle relier une nouvelle affectation : celle qui porte
 * l'affectation la plus proche avant la nouvelle heure, sinon la plus proche
 * après, sinon la fiche libre ouverte, sinon la plus récente.
 */
export function ficheARelier(fiches: FicheDuJour[], entrees: EntreeDuJour[], startAt: string): FicheDuJour | null {
  const ouvertes = fiches.filter((f) => f.status !== "done");
  if (!ouvertes.length) return null;
  const debut = Date.parse(startAt);
  const candidates = ouvertes
    .flatMap((f) => entreesDeLaFiche(f, entrees).map((e) => ({ f, ecart: Date.parse(e.start_at) - debut })));
  const avant = candidates.filter((c) => c.ecart <= 0).sort((a, b) => b.ecart - a.ecart)[0];
  const apres = candidates.filter((c) => c.ecart > 0).sort((a, b) => a.ecart - b.ecart)[0];
  return (
    avant?.f ??
    apres?.f ??
    ouvertes.find((f) => !f.fiche_planifiee) ??
    [...ouvertes].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
    null
  );
}

/** Nom d'une fiche d'après les numéros de tournée qu'elle porte. */
export function nomFiche(numeros: string[]): string {
  const uniques = [...new Set(numeros)];
  if (!uniques.length) return "Tournée";
  const nom = uniques.length === 1 ? `Tournée n°${uniques[0]}` : uniques.length <= 4 ? `Tournées n°${uniques.join(", ")}` : "Tournées du jour";
  return nom.slice(0, 60);
}

/** Texte de la question posée à l'encadrement. */
export function questionRegroupement(choix: Pick<ChoixRequis, "existantes" | "fiches_ouvertes">): string {
  const suite = "Tournées colis séparées (recommandé) ou reliées en une seule ?";
  if (choix.existantes.length) {
    const liste = choix.existantes.map((e) => `la tournée n°${e.tour_number} à ${e.heure}`);
    const debut = liste.length === 1 ? liste[0] : `${liste.slice(0, -1).join(", ")} et ${liste.at(-1)}`;
    return `Ce chauffeur a déjà ${debut} ce jour-là. ${suite}`;
  }
  const noms = choix.fiches_ouvertes.map((f) => `« ${f.name ?? "Tournée"} »`).join(", ");
  return `Ce chauffeur a déjà une tournée colis ouverte ce jour-là (${noms}). ${suite}`;
}
