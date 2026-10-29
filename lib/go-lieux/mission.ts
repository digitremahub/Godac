/**
 * Mission libre de GO (« Aller à… ») : une destination et 0 à 3 étapes, EN
 * MÉMOIRE seulement. Jamais de delivery_run ni de delivery_stop : GO reçoit
 * une tournée virtuelle (id « libre ») dont les arrêts virtuels ne
 * correspondent à aucune ligne de base. Logique pure, testée dans
 * lib/go-lieux/__tests__.
 */
import { optimiserOrdre } from "@/lib/colis/optimisation";

export const MAX_ETAPES = 3;
/** Identifiant de la tournée virtuelle : pas un UUID, donc refusé par toutes les routes de tournée. */
export const ID_TOURNEE_LIBRE = "libre";
export const PREFIXE_ARRET_LIBRE = "libre-";

export interface Destination {
  libelle: string;
  adresse: string;
  lat: number;
  lng: number;
}

export interface MissionLibre {
  /** Étapes dans l'ordre choisi par l'utilisateur. */
  etapes: Destination[];
  destination: Destination;
}

export const estIdLibre = (id: string | null | undefined): boolean => id === ID_TOURNEE_LIBRE || Boolean(id?.startsWith(PREFIXE_ARRET_LIBRE));

const memeEndroit = (a: Destination, b: Destination) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

export type ResultatEtapes = { ok: true; etapes: Destination[] } | { ok: false; motif: "plafond" | "doublon" };

export function ajouterEtape(etapes: readonly Destination[], e: Destination, destination?: Destination | null): ResultatEtapes {
  if (etapes.length >= MAX_ETAPES) return { ok: false, motif: "plafond" };
  if (etapes.some((x) => memeEndroit(x, e)) || (destination && memeEndroit(destination, e))) return { ok: false, motif: "doublon" };
  return { ok: true, etapes: [...etapes, e] };
}

export function deplacerEtape(etapes: readonly Destination[], index: number, delta: -1 | 1): Destination[] {
  const vers = index + delta;
  if (index < 0 || index >= etapes.length || vers < 0 || vers >= etapes.length) return [...etapes];
  const copie = [...etapes];
  [copie[index], copie[vers]] = [copie[vers]!, copie[index]!];
  return copie;
}

export const retirerEtape = (etapes: readonly Destination[], index: number): Destination[] => etapes.filter((_, i) => i !== index);

/**
 * « Optimiser l'ordre » : l'optimiseur existant (lib/colis/optimisation.ts),
 * calculé sur le téléphone — aucun appel à /api/colis/optimiser, donc aucun
 * quota d'essai consommé. Départ : la position, arrivée imposée : la destination.
 */
export function optimiserEtapes(depart: { lat: number; lng: number } | null, etapes: readonly Destination[], destination: Destination): Destination[] {
  if (etapes.length < 2) return [...etapes];
  const ordre = optimiserOrdre(depart, etapes.map((e) => ({ lat: e.lat, lng: e.lng })), false, { lat: destination.lat, lng: destination.lng });
  return ordre.map((i) => etapes[i]!);
}

/** Étapes puis destination, dans l'ordre de passage. */
export const pointsDeLaMission = (m: MissionLibre): Destination[] => [...m.etapes, m.destination];

/** Arrêt virtuel pour GO (mêmes champs qu'un arrêt de tournée, rien n'est écrit en base). */
export function arretsVirtuels(m: MissionLibre, atteints: ReadonlySet<number>) {
  return pointsDeLaMission(m).map((d, i) => ({
    id: `${PREFIXE_ARRET_LIBRE}${i}`,
    position: i,
    parcel_code: null,
    parcel_count: 0,
    address: d.libelle && d.libelle !== d.adresse ? `${d.libelle} — ${d.adresse}` : d.adresse,
    lat: d.lat,
    lng: d.lng,
    recipient: null,
    phone: null,
    notes: null,
    status: (atteints.has(i) ? "delivered" : "pending") as "pending" | "delivered",
    delivered_place: null,
    proof_photo_path: null,
  }));
}

/** Tournée virtuelle : en cours, sans dépôt. */
export function tourneeVirtuelle() {
  return {
    id: ID_TOURNEE_LIBRE,
    name: "Aller à…",
    run_date: new Date().toISOString().slice(0, 10),
    status: "in_progress" as const,
    start_label: null,
    start_lat: null,
    start_lng: null,
    return_to_start: false,
    optimized_at: null,
  };
}

/** Le dernier point de la mission est-il celui qu'on vient d'atteindre ? */
export const estDerniere = (m: MissionLibre, index: number): boolean => index === m.etapes.length;

/**
 * Trace GPS d'historique : JAMAIS pour une mission libre. Seule une vraie
 * tournée (identifiant non virtuel) peut enregistrer un trajet.
 */
export function traceGpsAutorisee(runId: string | null | undefined): boolean {
  return Boolean(runId) && !estIdLibre(runId);
}
