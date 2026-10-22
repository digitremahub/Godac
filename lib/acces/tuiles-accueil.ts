// Tuiles des tableaux de bord : chaque tuile vise un écran du catalogue et
// ne s'affiche que si cet écran s'ouvre pour ce rôle, cette conduite et ces
// modules (deciderAcces). Plus aucune tuile vers un écran refusé ou
// « module non activé ». Fichier pur, testé dans lib/acces/__tests__.

import type { UserRole } from "@/lib/types/domain";
import { deciderAcces, ecran, horsOffreGoNavigation, urlDe } from "@/lib/acces/catalogue";

export type AccentTuile = "teal" | "orange" | "gold";

export interface Tuile {
  libelle: string;
  valeur: string;
  accent?: AccentTuile;
  /** Écran ouvert par la tuile (identifiant du catalogue). */
  ecran: string;
  /** Requête ou ancre ajoutée à l'adresse de l'écran (`?a_traiter=1`…). */
  suite?: string;
}

export interface TuileOuvrable extends Tuile {
  href: string;
}

export interface ContexteAccueil {
  role: UserRole;
  modules: ReadonlySet<string>;
  conduit?: boolean;
}

/** L'écran s'ouvre pour cette personne (rôle, conduite, modules, offre). */
export function ecranOuvrable(id: string, { role, modules, conduit = role === "chauffeur" }: ContexteAccueil): boolean {
  if (horsOffreGoNavigation(id, modules)) return false;
  return deciderAcces(ecran(id), role, modules, conduit).ok;
}

/** Tuiles dont l'écran s'ouvre, avec leur adresse. L'ordre est conservé. */
export function tuilesOuvrables(tuiles: readonly (Tuile | null | false | undefined | "")[], ctx: ContexteAccueil): TuileOuvrable[] {
  return tuiles
    .filter((t): t is Tuile => Boolean(t))
    .filter((t) => ecranOuvrable(t.ecran, ctx))
    .map((t) => ({ ...t, href: urlDe(t.ecran) + (t.suite ?? "") }));
}

/**
 * Écran de la tuile « Tournées en cours » : le suivi en direct (Tournée
 * colis), sinon le planning, sinon l'historique ; null si aucun ne s'ouvre.
 */
export function ecranTourneesEnCours(ctx: ContexteAccueil): string | null {
  return ["exploitation.suivi", "exploitation.planning", "exploitation.historique"].find((id) => ecranOuvrable(id, ctx)) ?? null;
}

/** Adresse de la tuile « Écarts carburant à traiter » (filtre de la page Pleins). */
export const SUITE_ECARTS_A_TRAITER = "?a_traiter=1";
