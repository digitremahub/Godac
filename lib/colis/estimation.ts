import { haversineKm } from "@/lib/colis/itineraire";
import { minutesParis } from "@/lib/colis/heure-paris";

/**
 * Avancement d'une tournée colis et heure de fin estimée — affichés au
 * chauffeur et sur la carte de suivi de l'exploitation.
 *
 * Deux méthodes :
 * - « rythme » dès 3 arrêts terminés : temps moyen constaté entre deux
 *   livraisons (trajet + remise), appliqué aux arrêts restants ;
 * - « estimation » avant : trajet restant (durée de l'itinéraire si connue,
 *   sinon distance × 1,3 à 35 km/h) + 3 min de remise par arrêt.
 * Le retour (au dépôt ou au point d'arrivée choisi) est ajouté s'il est prévu.
 *
 * Horaires d'ouverture (lib/colis/horaires.ts) : quand un arrêt restant a
 * des créneaux (`fenetres`, minutes depuis minuit à Paris), on estime
 * l'heure d'arrivée de chaque arrêt (même rythme ou même trajet que
 * ci-dessus) et on ajoute l'attente jusqu'à l'ouverture si on arrive en
 * avance. Approximation simple : ni l'ordre ni la durée d'itinéraire
 * routier ne sont recalculés.
 */
export interface ArretEstimation {
  status: "pending" | "delivered" | "failed";
  parcel_count: number;
  lat: number | null;
  lng: number | null;
  done_at: string | null;
  /** Créneaux d'ouverture du jour (null : pas de contrainte, [] : fermé). */
  fenetres?: [number, number][] | null;
}

export interface Avancement {
  adressesRestantes: number;
  colisRestants: number;
  adressesFaites: number;
  adressesTotal: number;
  /** ISO ; null si plus rien à livrer. */
  finEstimee: string | null;
  methode: "rythme" | "estimation" | null;
}

export const MINUTES_PAR_ARRET = 3;
export const VITESSE_KMH = 35;
const FACTEUR_ROUTE = 1.3;

/** Durée de trajet estimée (min) pour une distance à vol d'oiseau. */
export function minutesTrajet(km: number) {
  return ((km * FACTEUR_ROUTE) / VITESSE_KMH) * 60;
}

export function estimerAvancement(
  arrets: ArretEstimation[],
  options: {
    maintenant?: Date;
    position?: { lat: number; lng: number } | null;
    depot?: { lat: number; lng: number } | null;
    retourDepot?: boolean;
    /**
     * Point d'arrivée choisi (dépôt, adresse, départ…) : le trajet du dernier
     * arrêt jusqu'à lui compte dans l'heure de fin. null : pas de retour
     * imposé ; absent : `retourDepot` s'applique.
     */
    arrivee?: { lat: number; lng: number } | null;
    /** Durée de trajet restante connue (itinéraire routier), en minutes. */
    minutesItineraire?: number | null;
  } = {},
): Avancement {
  const maintenant = options.maintenant ?? new Date();
  const restants = arrets.filter((a) => a.status === "pending");
  const faits = arrets.filter((a) => a.status !== "pending");
  const base = {
    adressesRestantes: restants.length,
    colisRestants: restants.reduce((n, a) => n + a.parcel_count, 0),
    adressesFaites: faits.length,
    adressesTotal: arrets.length,
  };
  if (!restants.length) return { ...base, finEstimee: null, methode: null };

  const localises = restants.filter((a): a is ArretEstimation & { lat: number; lng: number } => a.lat !== null && a.lng !== null);
  const dernierPoint = localises.length ? localises[localises.length - 1]! : options.position ?? null;
  const cibleRetour = options.arrivee !== undefined ? options.arrivee : options.retourDepot ? (options.depot ?? null) : null;
  const retour = cibleRetour && dernierPoint ? minutesTrajet(haversineKm(dernierPoint, cibleRetour)) : 0;

  const horodates = faits
    .map((a) => (a.done_at ? Date.parse(a.done_at) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  let minutes: number;
  let methode: Avancement["methode"];
  let cycle: number | null = null;
  if (horodates.length >= 3) {
    cycle = Math.min(30, Math.max(1, (horodates[horodates.length - 1]! - horodates[0]!) / 60000 / (horodates.length - 1)));
    minutes = restants.length * cycle + retour;
    methode = "rythme";
  } else {
    let trajet = options.minutesItineraire ?? null;
    if (trajet === null) {
      let km = 0;
      let prec: { lat: number; lng: number } | null = options.position ?? null;
      for (const a of localises) {
        if (prec) km += haversineKm(prec, a);
        prec = a;
      }
      trajet = minutesTrajet(km) + retour;
    }
    minutes = trajet + restants.length * MINUTES_PAR_ARRET;
    methode = "estimation";
  }
  minutes += attentesOuverture(restants, cycle, options.position ?? null, minutesParis(maintenant));
  return { ...base, finEstimee: new Date(maintenant.getTime() + minutes * 60000).toISOString(), methode };
}

/**
 * Attente cumulée (min) aux adresses à horaires où l'on arriverait avant
 * l'ouverture : arrêts parcourus dans l'ordre depuis maintenant, chacun
 * coûtant le rythme constaté, ou trajet + remise.
 */
function attentesOuverture(restants: ArretEstimation[], cycle: number | null, position: { lat: number; lng: number } | null, maintenant: number): number {
  if (!restants.some((a) => a.fenetres?.length)) return 0;
  let t = maintenant;
  let attente = 0;
  let prec = position;
  for (const a of restants) {
    const point = a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng } : null;
    const arrivee = t + (cycle ?? (prec && point ? minutesTrajet(haversineKm(prec, point)) : 0));
    if (point) prec = point;
    const ouverture = a.fenetres?.find(([, c]) => arrivee < c)?.[0];
    const w = ouverture !== undefined && ouverture > arrivee ? ouverture - arrivee : 0;
    attente += w;
    t = arrivee + w + (cycle === null ? MINUTES_PAR_ARRET : 0);
  }
  return attente;
}

/** « 16 h 40 » (heure de Paris). */
export function heureFin(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
}
