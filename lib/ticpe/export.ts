import { isTicpeSafeToInclude } from "@/lib/business/ticpe";
import type { VehicleType } from "@/lib/types/domain";

/**
 * Règles de l'export TICPE (audit carburant) — pures et testées :
 * éligibilité d'un véhicule, bornes de période en heure de Paris.
 */

/** Seuil réglementaire du remboursement partiel : PTAC ≥ 7,5 t. */
export const PTAC_MIN_KG = 7500;

const MOTORISATION_NON_GAZOLE = /essence|sp ?9[58]|e85|[ée]lectri|gnv|gnl|gpl|hydrog|bio ?gaz/i;

export interface VehiculeTicpe {
  type: VehicleType;
  spec_sources?: Record<string, { origin: string; confirmed: boolean } | undefined> | null;
  ptac_kg?: number | string | null;
  fuel_type?: string | null;
}

export type Eligibilite = { inclus: true; ptacInconnu: boolean } | { inclus: false; raison: string };

export function eligibiliteTicpe(v: VehiculeTicpe): Eligibilite {
  if (v.type !== "PL" && v.type !== "SPL") return { inclus: false, raison: "véhicule léger" };
  if (!isTicpeSafeToInclude(v.type, v.spec_sources)) return { inclus: false, raison: "type estimé par l'IA non confirmé" };
  if (v.fuel_type && MOTORISATION_NON_GAZOLE.test(v.fuel_type)) return { inclus: false, raison: `motorisation ${v.fuel_type}` };
  const ptac = v.ptac_kg === null || v.ptac_kg === undefined || v.ptac_kg === "" ? null : Number(v.ptac_kg);
  if (ptac !== null && Number.isFinite(ptac) && ptac < PTAC_MIN_KG) return { inclus: false, raison: `PTAC ${ptac} kg < 7,5 t` };
  return { inclus: true, ptacInconnu: ptac === null || !Number.isFinite(ptac) };
}

/** Décalage de Paris par rapport à UTC (minutes) à un instant donné. */
function decalageParis(instant: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((local - instant.getTime()) / 60000);
}

/** Minuit (heure de Paris) du jour AAAA-MM-JJ, en ISO UTC. */
export function minuitParis(jour: string): string {
  const [y, m, d] = jour.split("-").map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d);
  return new Date(utc - decalageParis(new Date(utc)) * 60000).toISOString();
}

/** Bornes [début, fin[ d'une période de jours entiers, heure de Paris. */
export function bornesPeriode(debut: string, fin: string): { depuis: string; avant: string } {
  const [y, m, d] = fin.split("-").map(Number) as [number, number, number];
  const lendemain = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { depuis: minuitParis(debut), avant: minuitParis(lendemain) };
}
