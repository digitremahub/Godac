/**
 * Planning de présence des pôles bureau (lib/organization/poles.ts) :
 * une ligne planning_entries par personne et par jour, avec ses
 * horaires — sans véhicule ni tournée. Fonctions pures, partagées par
 * la route (app/api/planning/presence) et l'écran (PresencePlanning).
 */
import { PRESENCE_KIND, PRESENCE_STATUS, numeroPresence } from "@/lib/organization/poles";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface LignePresence {
  organization_id: string;
  service_id: string;
  driver_id: string;
  tour_number: string;
  kind: typeof PRESENCE_KIND;
  status: typeof PRESENCE_STATUS;
  vehicle_id: null;
  start_at: string;
  end_at: string;
}

/**
 * Lignes à écrire pour une personne : un jour par décalage coché
 * (0 = lundi … 6 = dimanche) de la semaine `weekStart`, de `debut` à
 * `fin` heure de Paris. Erreur lisible si les horaires sont invalides.
 */
export function lignesPresence(params: {
  organizationId: string;
  serviceId: string;
  userId: string;
  weekStart: string;
  jours: number[];
  debut: string;
  fin: string;
}): { ok: true; lignes: LignePresence[] } | { ok: false; erreur: string } {
  if (!HEURE.test(params.debut) || !HEURE.test(params.fin)) return { ok: false, erreur: "Horaires invalides (format HH:MM)." };
  if (params.fin <= params.debut) return { ok: false, erreur: "L'heure de fin doit être après l'heure d'arrivée." };
  const jours = [...new Set(params.jours)].filter((j) => Number.isInteger(j) && j >= 0 && j <= 6).sort();
  if (jours.length === 0) return { ok: false, erreur: "Cochez au moins un jour." };
  return {
    ok: true,
    lignes: jours.map((j) => {
      const jour = addDays(params.weekStart, j);
      return {
        organization_id: params.organizationId,
        service_id: params.serviceId,
        driver_id: params.userId,
        tour_number: numeroPresence(params.userId),
        kind: PRESENCE_KIND,
        status: PRESENCE_STATUS,
        vehicle_id: null,
        start_at: parisWallTimeToUtcISOString(jour, params.debut),
        end_at: parisWallTimeToUtcISOString(jour, params.fin),
      };
    }),
  };
}

/** Heure de Paris « HH:MM » d'un instant UTC. */
export function heureParis(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** « 7,5 h » */
export function formatHeures(h: number): string {
  return `${h.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
}
