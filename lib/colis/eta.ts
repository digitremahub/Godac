/**
 * Heure d'arrivée au prochain arrêt (GO Navigation) : heure « 14 h 32 »,
 * durée « dans 7 min » et distance restante, à partir de la position GPS
 * et de l'itinéraire OSRM déjà calculé (aucun appel réseau en plus).
 *
 * Logique pure, testée dans lib/colis/__tests__/eta.test.ts.
 */
import { formatDistance, formatDuree } from "@/lib/colis/navigation";

/** Vitesse moyenne de repli quand OSRM ne donne pas de durée (ville et routes de campagne). */
export const VITESSE_REPLI_KMH = 30;

const FORMAT_HEURE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** « 14 h 32 » (heure de Paris) pour un instant en millisecondes. */
export function heureArrivee(instantMs: number): string {
  const p: Record<string, string> = {};
  for (const x of FORMAT_HEURE.formatToParts(new Date(instantMs))) p[x.type] = x.value;
  return `${String(Number(p.hour) % 24).padStart(2, "0")} h ${p.minute}`;
}

/** « dans 7 min », « dans < 1 min », « dans 1 h 05 ». */
export function dansDuree(minutes: number): string {
  return `dans ${formatDuree(minutes)}`;
}

export interface EtaArret {
  /** Heure d'arrivée, « 14 h 32 ». */
  heure: string;
  /** Durée restante, « dans 7 min ». */
  dans: string;
  /** Distance restante, « 2,4 km ». */
  distance: string;
  /** true : durée déduite de la distance (pas de durée OSRM) ou tracé approximatif. */
  estimee: boolean;
}

/**
 * ETA du prochain arrêt. `dureeMin` : durée OSRM restante (déjà ramenée à
 * la distance restante sur le tracé) ; sans elle, on l'estime à
 * VITESSE_REPLI_KMH. Rien sans distance connue.
 */
export function etaArret(e: { maintenant: number; distanceM: number | null; dureeMin: number | null; approx?: boolean }): EtaArret | null {
  if (e.distanceM == null || !Number.isFinite(e.distanceM) || e.distanceM < 0) return null;
  const osrm = e.dureeMin != null && Number.isFinite(e.dureeMin) && e.dureeMin >= 0;
  const minutes = osrm ? e.dureeMin! : (e.distanceM / 1000 / VITESSE_REPLI_KMH) * 60;
  return {
    heure: heureArrivee(e.maintenant + minutes * 60_000),
    dans: dansDuree(minutes),
    distance: formatDistance(e.distanceM),
    estimee: !osrm || Boolean(e.approx),
  };
}
