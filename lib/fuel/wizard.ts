/**
 * Parcours de l'assistant de plein (components/fuel/NewFuelEntryWizard.tsx) :
 * quels écrans, dans quel ordre, selon ce qui est déjà connu. Chauffeur
 * (compte connecté, badge scanné), véhicule (affecté, dernier utilisé, QR) et
 * cuve (QR) connus ne se redemandent pas : l'assistant démarre à l'odomètre avec
 * un bandeau « Chauffeur · Véhicule [modifier] ». Fichier pur, testé dans
 * lib/fuel/__tests__/wizard.test.ts (objectif : 5 écrans et 7 interactions au
 * plus pour un ticket lu automatiquement).
 */

export type Phase = "driver" | "vehicle" | "odometer" | "capture-choice" | "ocr" | "station" | "tank" | "tank-totalizers" | "validate" | "submitted";

export interface Connus {
  chauffeur: boolean;
  vehicule: boolean;
  cuve?: boolean;
}

/** Premier écran : le premier élément inconnu, sinon directement le kilométrage. */
export function phaseInitiale(connus: Connus): Phase {
  if (!connus.chauffeur) return "driver";
  if (!connus.vehicule) return "vehicle";
  return "odometer";
}

/** Écran qui suit le choix du chauffeur. */
export function phaseApresChauffeur(connus: Pick<Connus, "vehicule">): Phase {
  return connus.vehicule ? "odometer" : "vehicle";
}

export type Branche = "ocr" | "station_manuelle" | "cuve";

/** Écrans parcourus (hors confirmation finale), dans l'ordre. L'écran « ocr » compte la prise de photo puis la vérification. */
export function ecransDuParcours(branche: Branche, connus: Connus): Phase[] {
  const ecrans: Phase[] = [];
  if (!connus.chauffeur) ecrans.push("driver");
  if (!connus.vehicule) ecrans.push("vehicle");
  ecrans.push("odometer", "capture-choice");
  if (branche === "ocr") ecrans.push("ocr");
  else if (branche === "station_manuelle") ecrans.push("station");
  else {
    if (!connus.cuve) ecrans.push("tank");
    ecrans.push("tank-totalizers", "validate");
  }
  return ecrans;
}

/**
 * Interactions minimales par écran quand les photos sont lues automatiquement
 * (OCR actif) : choisir ou prendre une photo, puis valider. Un écran « ocr » =
 * photo du ticket + validation du formulaire pré-rempli.
 */
export const INTERACTIONS_LECTURE_AUTO: Readonly<Record<Phase, number>> = {
  driver: 2,
  vehicle: 2,
  odometer: 2,
  "capture-choice": 1,
  ocr: 2,
  station: 4,
  tank: 2,
  "tank-totalizers": 3,
  validate: 1,
  submitted: 0,
};

export function interactionsMinimales(branche: Branche, connus: Connus): number {
  return ecransDuParcours(branche, connus).reduce((n, e) => n + INTERACTIONS_LECTURE_AUTO[e], 0);
}

/** « 125 430 km le 12/10/2026 » : dernier relevé connu, affiché à l'étape du kilométrage. */
export function libelleDernierReleve(releve: { km: number; at: string } | null | undefined): string | null {
  if (!releve) return null;
  const date = new Date(releve.at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  return `${releve.km.toLocaleString("fr-FR")} km le ${date}`;
}
