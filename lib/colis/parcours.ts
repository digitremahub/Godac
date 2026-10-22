/**
 * Parcours unique « Ma tournée colis » du conducteur (/livreur) :
 * Préparer → Démarrer → Livrer → Clôturer, sur un seul écran. Le
 * chauffeur n'a plus à savoir qu'il existe un écran de préparation
 * (scan, bordereau, adresses) et une application de livraison : l'étape
 * courante est déduite du statut de la tournée colis (delivery_runs) et
 * de ses arrêts.
 *
 * Logique pure, testée dans lib/colis/__tests__/parcours.test.ts.
 */

export type StatutTourneeColis = "loading" | "in_progress" | "done";

export type EtapeParcours = "preparer" | "demarrer" | "livrer" | "cloturer" | "terminee";

export interface EtatParcours {
  /** Statut de la tournée colis affichée ; null : aucune tournée colis. */
  statut: StatutTourneeColis | null;
  /** Nombre d'arrêts chargés. */
  arrets: number;
  /** Arrêts encore à traiter (ni livrés ni en échec). */
  restants: number;
}

/**
 * Étape courante :
 *  - aucune tournée colis, ou tournée en préparation sans arrêt → Préparer ;
 *  - en préparation avec au moins un arrêt → Démarrer (on peut encore en ajouter) ;
 *  - démarrée avec des arrêts restants → Livrer ;
 *  - démarrée, tous les arrêts traités → Clôturer ;
 *  - clôturée → Terminée (verrouillée ; une tournée supplémentaire reste possible).
 */
export function etapeParcours(e: EtatParcours): EtapeParcours {
  if (e.statut === null) return "preparer";
  if (e.statut === "done") return "terminee";
  if (e.statut === "in_progress") return e.restants > 0 ? "livrer" : "cloturer";
  return e.arrets > 0 ? "demarrer" : "preparer";
}

/** Les quatre étapes affichées en tête de l'écran, dans l'ordre. */
export const ETAPES_PARCOURS: readonly { id: Exclude<EtapeParcours, "terminee">; libelle: string }[] = [
  { id: "preparer", libelle: "Préparer" },
  { id: "demarrer", libelle: "Démarrer" },
  { id: "livrer", libelle: "Livrer" },
  { id: "cloturer", libelle: "Clôturer" },
];

export type EtatEtape = "faite" | "en_cours" | "a_venir";

/** État de chaque étape pour l'indicateur (une tournée terminée a tout fait). */
export function etatsEtapes(etape: EtapeParcours): { id: string; libelle: string; etat: EtatEtape }[] {
  const rang = etape === "terminee" ? ETAPES_PARCOURS.length : ETAPES_PARCOURS.findIndex((x) => x.id === etape);
  return ETAPES_PARCOURS.map((x, i) => ({ ...x, etat: i < rang ? "faite" : i === rang ? "en_cours" : "a_venir" }));
}

/**
 * L'écran de préparation (scan, photo d'étiquette, bordereau, saisie
 * d'adresse avec créneau, listes) est affiché pour Préparer, Démarrer et
 * une tournée terminée (lecture seule et « + Nouvelle tournée »), ou à la
 * demande pendant la livraison (« Ajouter ou modifier des colis »).
 * Livrer et Clôturer restent sur l'application de livraison (arrêt en
 * cours, GO Navigation, carte).
 */
export function afficherPreparation(etape: EtapeParcours, demandee: boolean): boolean {
  return demandee || etape === "preparer" || etape === "demarrer" || etape === "terminee";
}

/** Action principale proposée à chaque étape (bouton du bas). */
export function actionPrincipale(etape: EtapeParcours): string {
  switch (etape) {
    case "preparer":
      return "Ajouter des colis";
    case "demarrer":
      return "Vérifier la tournée et démarrer";
    case "livrer":
      return "Livrer l'arrêt en cours";
    case "cloturer":
      return "Clôturer la tournée colis";
    case "terminee":
      return "Nouvelle tournée colis";
  }
}
