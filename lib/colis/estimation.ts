import { haversineKm } from "@/lib/colis/itineraire";

/**
 * Avancement d'une tournée colis et heure de fin estimée — affichés au
 * chauffeur et sur la carte de suivi de l'exploitation.
 *
 * Deux méthodes :
 * - « rythme » dès 3 arrêts terminés : temps moyen constaté entre deux
 *   livraisons (trajet + remise), appliqué aux arrêts restants ;
 * - « estimation » avant : trajet restant (durée de l'itinéraire si connue,
 *   sinon distance × 1,3 à 35 km/h) + 3 min de remise par arrêt.
 * Le retour au dépôt est ajouté s'il est prévu.
 */
export interface ArretEstimation {
  status: "pending" | "delivered" | "failed";
  parcel_count: number;
  lat: number | null;
  lng: number | null;
  done_at: string | null;
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

function minutesTrajet(km: number) {
  return ((km * FACTEUR_ROUTE) / VITESSE_KMH) * 60;
}

export function estimerAvancement(
  arrets: ArretEstimation[],
  options: {
    maintenant?: Date;
    position?: { lat: number; lng: number } | null;
    depot?: { lat: number; lng: number } | null;
    retourDepot?: boolean;
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
  const retour =
    options.retourDepot && options.depot && dernierPoint ? minutesTrajet(haversineKm(dernierPoint, options.depot)) : 0;

  const horodates = faits
    .map((a) => (a.done_at ? Date.parse(a.done_at) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  let minutes: number;
  let methode: Avancement["methode"];
  if (horodates.length >= 3) {
    const cycle = (horodates[horodates.length - 1]! - horodates[0]!) / 60000 / (horodates.length - 1);
    minutes = restants.length * Math.min(30, Math.max(1, cycle)) + retour;
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
  return { ...base, finEstimee: new Date(maintenant.getTime() + minutes * 60000).toISOString(), methode };
}

/** « 16 h 40 » (heure de Paris). */
export function heureFin(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
}
