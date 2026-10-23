/**
 * Doublons de pleins (ticket de station + ligne du relevé de carte) — pur, testé.
 *
 * Deux pleins du même véhicule sont un doublon probable si leurs litres sont
 * proches et qu'ils tombent le même jour de Paris (un relevé de carte n'a
 * souvent que la date, donc minuit), ou à 30 minutes au plus l'un de l'autre.
 * Tant qu'une personne n'a pas confirmé « deux pleins distincts », UNE des
 * deux lignes est écartée du montant : l'autre est gardée.
 */

import { jourParis, type LigneTicpe } from "@/lib/ticpe/montant";

/** Écart horaire maximal de la règle « fenêtre horaire ». */
export const DOUBLON_MINUTES = 30;

export interface ToleranceDoublon {
  /** Écart relatif toléré (0,02 = 2 %). */
  pourcent: number;
  /** Écart absolu toléré, en litres. */
  litres: number;
}

/** ±2 % ou ±2 L, le plus large des deux. */
export const TOLERANCE_DOUBLON_PAR_DEFAUT: ToleranceDoublon = { pourcent: 0.02, litres: 2 };

export function litresProches(a: number, b: number, tol: ToleranceDoublon = TOLERANCE_DOUBLON_PAR_DEFAUT): boolean {
  return Math.abs(a - b) <= Math.max(tol.litres, tol.pourcent * Math.max(a, b));
}

export interface PleinDoublon {
  id: string;
  vehicle_id: string;
  occurred_at: string;
  liters: number | string | null;
  tank_id?: string | null;
  ticket_photo_path?: string | null;
  ticpe_justificatif?: string | null;
  /** Une personne a confirmé que ce plein est distinct des autres (migration 20261101000003). */
  ticpe_doublon_leve_le?: string | null;
}

function nombre(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Paires de pleins probablement saisis deux fois. Une paire dont l'un des
 * pleins a été confirmé « distinct » par une personne n'est plus signalée.
 * Deux pleins à la cuve (totaliseur mesuré) ne comptent pas comme doublon
 * le même jour : seule la fenêtre de 30 minutes les rapproche.
 */
export function doublonsProbables<P extends PleinDoublon>(pleins: readonly P[], tol: ToleranceDoublon = TOLERANCE_DOUBLON_PAR_DEFAUT): [P, P][] {
  const parVehicule = new Map<string, P[]>();
  for (const p of pleins) {
    if (nombre(p.liters) === null || Number.isNaN(Date.parse(p.occurred_at))) continue;
    const l = parVehicule.get(p.vehicle_id) ?? [];
    l.push(p);
    parVehicule.set(p.vehicle_id, l);
  }
  const paires: [P, P][] = [];
  for (const liste of parVehicule.values()) {
    liste.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id.localeCompare(b.id));
    for (let i = 0; i < liste.length; i++) {
      const a = liste[i]!;
      const ta = Date.parse(a.occurred_at);
      const jourA = jourParis(a.occurred_at);
      for (let j = i + 1; j < liste.length; j++) {
        const b = liste[j]!;
        const dansFenetre = Date.parse(b.occurred_at) - ta <= DOUBLON_MINUTES * 60000;
        const memeJour = jourParis(b.occurred_at) === jourA && !(a.tank_id && b.tank_id);
        if (!dansFenetre && !memeJour && jourParis(b.occurred_at) > jourA) break;
        if (!dansFenetre && !memeJour) continue;
        if (a.ticpe_doublon_leve_le || b.ticpe_doublon_leve_le) continue;
        if (litresProches(nombre(a.liters)!, nombre(b.liters)!, tol)) paires.push([a, b]);
      }
    }
  }
  return paires;
}

const pieces = (p: PleinDoublon) => (p.ticket_photo_path ? 2 : 0) + (p.ticpe_justificatif ? 1 : 0);

/** Des deux pleins d'un doublon, celui qu'on garde (le mieux justifié, sinon le plus ancien) et celui qu'on écarte. */
export function departager<P extends PleinDoublon>(a: P, b: P): { garde: P; ecarte: P } {
  const d = pieces(b) - pieces(a);
  if (d > 0) return { garde: b, ecarte: a };
  if (d < 0) return { garde: a, ecarte: b };
  const t = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  return t > 0 || (t === 0 && a.id > b.id) ? { garde: b, ecarte: a } : { garde: a, ecarte: b };
}

/** Pleins écartés du montant (id → plein gardé en face), au plus un par paire. */
export function pleinsEcartes<P extends PleinDoublon>(paires: readonly [P, P][]): Map<string, P> {
  const ecartes = new Map<string, P>();
  for (const [a, b] of paires) {
    if (ecartes.has(a.id) || ecartes.has(b.id)) continue;
    const { garde, ecarte } = departager(a, b);
    ecartes.set(ecarte.id, garde);
  }
  return ecartes;
}

const dateHeure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

/**
 * Écarte du montant les lignes en doublon probable (sauf déjà exclues) :
 * statut « exclu », raison explicite, montant nul. À appliquer avant le plafond.
 */
export function exclureDoublons<P extends PleinDoublon>(lignes: readonly LigneTicpe[], pleins: readonly P[], tol?: ToleranceDoublon): LigneTicpe[] {
  const ecartes = pleinsEcartes(doublonsProbables(pleins, tol));
  if (ecartes.size === 0) return [...lignes];
  return lignes.map((l) => {
    const garde = ecartes.get(l.id);
    if (!garde || l.statut === "exclu") return l;
    return {
      ...l,
      statut: "exclu",
      raison: `Doublon probable avec le plein du ${dateHeure(garde.occurred_at)} : non compté tant que vous n'avez pas confirmé deux pleins distincts.`,
      doublon: true,
      litresRetenus: 0,
      litresHorsPlafond: 0,
      montant: 0,
    };
  });
}
