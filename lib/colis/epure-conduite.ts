// GO Navigation, écran de conduite épuré : ce qui reste affiché selon que le
// véhicule roule ou non. Logique pure, testée dans
// lib/colis/__tests__/epure-conduite.test.ts.
//  - à l'arrêt : tout est accessible (menu Options, carte de l'arrêt, liste) ;
//  - en mouvement : seulement ce qui sert à conduire (consigne de manœuvre,
//    distance / heure d'arrivée, vitesse et limite, « Livré » de l'arrêt en
//    cours, « Recentrer » si la carte a été déplacée, guidage vocal).

import type { Point } from "@/lib/colis/itineraire";

/** Au-dessus de cette vitesse (km/h, GPS), le véhicule est considéré en mouvement. */
export const SEUIL_MOUVEMENT_KMH = 5;
/** En dessous, il est de nouveau à l'arrêt (hystérésis : pas de va-et-vient autour du seuil). */
export const SEUIL_ARRET_KMH = 3;

/**
 * Mouvement après un nouveau relevé de vitesse. `precedent` évite que l'écran
 * clignote quand la vitesse GPS oscille autour du seuil ; sans vitesse connue
 * (pas de GPS), on garde l'état précédent.
 */
export function enMouvementApres(precedent: boolean, vitesseKmh: number | null | undefined): boolean {
  if (vitesseKmh === null || vitesseKmh === undefined || !Number.isFinite(vitesseKmh)) return precedent;
  return precedent ? vitesseKmh >= SEUIL_ARRET_KMH : vitesseKmh > SEUIL_MOUVEMENT_KMH;
}

/**
 * Bandeau de guidage : compact en conduite (pictogramme, distance, rue, une
 * ligne d'arrivée). Les détails (« puis… », avancement, fin estimée) se
 * déplient à l'arrêt ou au toucher du bandeau. `choix` : dernier toucher
 * (null : automatique, remis à null quand le véhicule démarre ou s'arrête).
 */
export function bandeauDeplie(mouvement: boolean, choix: boolean | null): boolean {
  return choix ?? !mouvement;
}

export type VueCarte = "conduite" | "ensemble" | "libre";

export interface EntreeEpure {
  mouvement: boolean;
  vue: VueCarte;
  /** Position GPS connue. */
  position: Point | null;
  /** Tournée clôturée : consultation seulement. */
  fige: boolean;
  /** Tournée en cours (démarrée). */
  enCours: boolean;
  /** Trajet enregistré pour l'historique (indicateur RGPD). */
  traceActive: boolean;
  /** Toucher du bandeau (null : automatique, voir `bandeauDeplie`). */
  choixBandeau?: boolean | null;
}

export interface ElementsConduite {
  /** Bouton « ‹ » : retour à la tournée colis. */
  retour: boolean;
  /** Bouton « Options » (ajout d'adresse, optimisation, vues, mode simple). */
  menuOptions: boolean;
  /** Boussole « nord en haut ». */
  boussole: boolean;
  /** Bouton unique « Recentrer » (carte déplacée ou vue d'ensemble). */
  recentrer: boolean;
  /** Détails du bandeau : « puis… », « 12/40 faits · colis · fin ≈ 17:30 » (dépliés à l'arrêt ou au toucher). */
  ligneEtat: boolean;
  /** Indicateur « trajet enregistré » dans la ligne d'état (obligation de transparence : reste visible). */
  indicateurTrace: boolean;
  /** Bouton « ⋯ » (menu de l'arrêt) de la feuille réduite. */
  actionsArret: boolean;
  /** La feuille se replie d'elle-même (moyenne et pleine ne servent pas en roulant). */
  replierFeuille: boolean;
}

/** Éléments affichés par l'écran de conduite, à l'arrêt ou en mouvement. */
export function elementsConduite(e: EntreeEpure): ElementsConduite {
  const arrete = !e.mouvement;
  return {
    retour: arrete,
    menuOptions: arrete,
    boussole: arrete && e.vue !== "ensemble",
    recentrer: e.position !== null && e.vue !== "conduite",
    ligneEtat: bandeauDeplie(e.mouvement, e.choixBandeau ?? null) && !e.fige,
    indicateurTrace: e.traceActive,
    actionsArret: arrete,
    replierFeuille: e.mouvement,
  };
}
