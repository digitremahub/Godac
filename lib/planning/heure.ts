/**
 * Heure de départ d'une tournée : logique pure partagée entre l'écran
 * (components/planning/FeuilleHeure.tsx) et la route
 * app/api/planning/heure ; testée dans lib/planning/__tests__/heure.test.ts.
 *
 * Trois portées : seulement ce jour, tous les jours d'une période (la
 * semaine, le mois), ou « toujours » (heure de départ du modèle de planning,
 * qui sert aux prochaines générations). Les affectations déjà démarrées ne
 * changent jamais ; le chauffeur d'une affectation modifiée est prévenu par
 * le même chemin que tout changement d'heure (trigger de publication :
 * migration 20261030000003, à la publication ou tout de suite si c'est pour
 * aujourd'hui ou demain).
 */
import { heureDe, jourDe, type AffectationPlanning } from "@/lib/planning/semaine";

export const HEURE_VALIDE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface ChangementHeure<T extends AffectationPlanning = AffectationPlanning> {
  entree: T;
  /** Jour de Paris de l'affectation. */
  date: string;
  ancienne: string;
  nouveauStartAt: string;
  /** Un chauffeur est placé : il sera prévenu du changement. */
  prevenir: boolean;
}

/**
 * Affectations touchées par un changement d'heure : celles de cette tournée
 * (service + numéro), encore « prévues », dont le jour est dans la période
 * (bornes incluses) et dont l'heure est différente.
 */
export function changementsHeure<T extends AffectationPlanning>(
  entrees: readonly T[],
  p: { serviceId: string; tourNumber: string; debut: string; fin: string; heure: string; versUtc: (date: string, heure: string) => string },
): ChangementHeure<T>[] {
  const out: ChangementHeure<T>[] = [];
  for (const e of entrees) {
    if (e.service_id !== p.serviceId || e.tour_number !== p.tourNumber || e.status !== "planned") continue;
    const date = jourDe(e.start_at);
    if (date < p.debut || date > p.fin) continue;
    const ancienne = heureDe(e.start_at);
    if (ancienne === p.heure) continue;
    out.push({ entree: e, date, ancienne, nouveauStartAt: p.versUtc(date, p.heure), prevenir: Boolean(e.driver_id) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Modèles de planning d'une tournée (service + numéro), pour « Toujours ». */
export function modelesDeLaTournee<T extends { service_id: string; tour_number: string }>(modeles: readonly T[], serviceId: string, tourNumber: string): T[] {
  return modeles.filter((m) => m.service_id === serviceId && m.tour_number === tourNumber);
}

/** « 3 affectations passées à 06:00 (2 chauffeurs prévenus à la publication) » */
export function texteChangementHeure(r: { modifiees: number; prevenus: number; heure: string; modele?: boolean; conflits?: number }): string {
  const parts: string[] = [];
  if (r.modele) parts.push(`Heure habituelle passée à ${r.heure}`);
  if (r.modifiees) parts.push(`${r.modifiees} affectation${r.modifiees > 1 ? "s" : ""} passée${r.modifiees > 1 ? "s" : ""} à ${r.heure}`);
  if (r.prevenus) parts.push(`${r.prevenus} chauffeur${r.prevenus > 1 ? "s" : ""} prévenu${r.prevenus > 1 ? "s" : ""} (à la publication, ou tout de suite si c'est pour aujourd'hui ou demain)`);
  if (r.conflits) parts.push(`${r.conflits} laissée${r.conflits > 1 ? "s" : ""} telle${r.conflits > 1 ? "s" : ""} quelle${r.conflits > 1 ? "s" : ""} (créneau déjà pris)`);
  return parts.join(", ") || "Rien à changer";
}
