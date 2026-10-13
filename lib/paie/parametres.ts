import type { ParametresLegaux } from "@/lib/paie/types";

/**
 * Paramètres légaux de la paie, versionnés par date d'effet. Un seul
 * endroit à mettre à jour à chaque revalorisation (SMIC, PMSS, taux) :
 * ajouter un nouveau jeu en tête de PARAMETRES, sans toucher aux
 * anciens — un bulletin de mars garde les taux de mars.
 *
 * Sources (vérifiées en octobre 2026) : urssaf.fr, agirc-arrco.fr,
 * legifrance.gouv.fr, bofip.impots.gouv.fr.
 */
/** Taux et plafonds communs à toute l'année 2026 (urssaf.fr, agirc-arrco.fr). */
const BASE_2026: Omit<ParametresLegaux, "effetAu" | "smicHoraire" | "tauxNeutrePas"> = {
  pmss: 4005,
  // Taux réduits maladie (7 %) et allocations familiales (3,45 %)
  // supprimés en 2026 dans le cas général : intégrés à la RGDU.
  maladie: { normal: 13, reduit: 13, seuilReduitSmic: 0 },
  vieillessePlafonnee: { salarial: 6.9, patronal: 8.55 },
  vieillesseDeplafonnee: { salarial: 0.4, patronal: 2.11 },
  allocationsFamiliales: { normal: 5.25, reduit: 5.25, seuilReduitSmic: 0 },
  csa: 0.3,
  fnal: { moins50: 0.1, auMoins50: 0.5 },
  chomage: 4,
  ags: 0.25,
  agircArrcoT1: { salarial: 3.15, patronal: 4.72 },
  cegT1: { salarial: 0.86, patronal: 1.29 },
  agircArrcoT2: { salarial: 8.64, patronal: 12.95 },
  cegT2: { salarial: 1.08, patronal: 1.62 },
  cet: { salarial: 0.14, patronal: 0.21 },
  apec: { salarial: 0.024, patronal: 0.036 },
  prevoyanceCadreMinT1: 1.5,
  csgDeductible: 6.8,
  csgNonDeductible: 2.4,
  crds: 0.5,
  assietteCsgPart: 98.25,
  dialogueSocial: 0.016,
  formationPro: { moins11: 0.55, auMoins11: 1 },
  taxeApprentissage: 0.68,
  heuresSup: {
    reductionSalariale: 11.31,
    plafondExonerationIrAnnuel: 7500,
    // Depuis le 1er janvier 2026 : 0,50 €/h à partir de 20 salariés, sans
    // plafond d'effectif (LFSS 2026), réservé aux salariés éligibles RGDU.
    deductionPatronaleParHeure: { moins20: 1.5, de20a249: 0.5 },
  },
  // RGDU (décret 2025-1446) : C = Tmin + Tdelta × [½ × (3 × SMIC / R − 1)]^1,75,
  // SMIC de référence = celui du 1er janvier 2026 (décret 2026-509).
  reductionGenerale: { smicHoraireReference: 12.02, plafondSmic: 3, tMin: 0.02, tDelta: { fnal010: 0.3781, fnal050: 0.3821 }, puissance: 1.75 },
};

/** Grille du taux neutre 2025, appliquée jusqu'au 30 avril 2026. */
const TAUX_NEUTRE_2025: ParametresLegaux["tauxNeutrePas"] = [
  { jusqua: 1620, taux: 0 },
  { jusqua: 1683, taux: 0.5 },
  { jusqua: 1791, taux: 1.3 },
  { jusqua: 1911, taux: 2.1 },
  { jusqua: 2042, taux: 2.9 },
  { jusqua: 2151, taux: 3.5 },
  { jusqua: 2294, taux: 4.1 },
  { jusqua: 2714, taux: 5.3 },
  { jusqua: 3107, taux: 7.5 },
  { jusqua: 3539, taux: 9.9 },
  { jusqua: 3983, taux: 11.9 },
  { jusqua: 4648, taux: 13.8 },
  { jusqua: 5574, taux: 15.8 },
  { jusqua: 7008, taux: 17.9 },
  { jusqua: 8933, taux: 20 },
  { jusqua: 12841, taux: 24 },
  { jusqua: 16568, taux: 28 },
  { jusqua: 25667, taux: 33 },
  { jusqua: 55474, taux: 38 },
  { jusqua: null, taux: 43 },
];

/** Grille du taux neutre 2026 (BOI-BAREME-000037-20260407), depuis le 1er mai 2026. */
const TAUX_NEUTRE_2026: ParametresLegaux["tauxNeutrePas"] = [
  { jusqua: 1635, taux: 0 },
  { jusqua: 1698, taux: 0.5 },
  { jusqua: 1807, taux: 1.3 },
  { jusqua: 1928, taux: 2.1 },
  { jusqua: 2060, taux: 2.9 },
  { jusqua: 2170, taux: 3.5 },
  { jusqua: 2315, taux: 4.1 },
  { jusqua: 2738, taux: 5.3 },
  { jusqua: 3135, taux: 7.5 },
  { jusqua: 3571, taux: 9.9 },
  { jusqua: 4019, taux: 11.9 },
  { jusqua: 4690, taux: 13.8 },
  { jusqua: 5624, taux: 15.8 },
  { jusqua: 7037, taux: 17.9 },
  { jusqua: 8789, taux: 20 },
  { jusqua: 12200, taux: 24 },
  { jusqua: 16523, taux: 28 },
  { jusqua: 25937, taux: 33 },
  { jusqua: 55558, taux: 38 },
  { jusqua: null, taux: 43 },
];

export const PARAMETRES: ParametresLegaux[] = [
  // SMIC revalorisé au 1er juin 2026 (arrêté du 22/05/2026).
  { ...BASE_2026, effetAu: "2026-06-01", smicHoraire: 12.31, tauxNeutrePas: TAUX_NEUTRE_2026 },
  { ...BASE_2026, effetAu: "2026-05-01", smicHoraire: 12.02, tauxNeutrePas: TAUX_NEUTRE_2026 },
  { ...BASE_2026, effetAu: "2026-01-01", smicHoraire: 12.02, tauxNeutrePas: TAUX_NEUTRE_2025 },
];

/** Jeu de paramètres applicable à une date (AAAA-MM-JJ). */
export function parametresLegauxAu(date: string): ParametresLegaux {
  const jeu = PARAMETRES.find((p) => p.effetAu <= date) ?? PARAMETRES[PARAMETRES.length - 1];
  if (!jeu) throw new Error("Aucun paramètre de paie défini.");
  return jeu;
}

/**
 * Frais de déplacement de la convention des transports routiers
 * (IDCC 16, protocole frais de déplacement) — valeurs par défaut,
 * remplaçables par l'entreprise dans les réglages de paie.
 */
export const FRAIS_CONVENTIONNELS = {
  // Avenant n° 81 du 02/12/2025, en vigueur au 01/01/2026 (TRM), étendu le 03/02/2026.
  repas: 16.36,
  repasUnique: 10.07,
  cassecroute: 8.87,
  /** Grand déplacement : 1 repas + découcher. */
  grandDeplacement: 52.31,
};

/**
 * Barème annuel de la part saisissable des rémunérations (art. R3252-2
 * du code du travail), revalorisé chaque année par décret : fraction
 * saisissable par tranche de rémunération annuelle nette, et majoration
 * des seuils par personne à charge. Valeurs 2025 — à vérifier et mettre
 * à jour à chaque revalorisation.
 */
export const BAREME_SAISIE = {
  effetAu: "2025-01-01",
  tranches: [
    { jusqua: 4370, fraction: 1 / 20 },
    { jusqua: 8520, fraction: 1 / 10 },
    { jusqua: 12690, fraction: 1 / 5 },
    { jusqua: 16820, fraction: 1 / 4 },
    { jusqua: 20940, fraction: 1 / 3 },
    { jusqua: 25200, fraction: 2 / 3 },
    { jusqua: null as number | null, fraction: 1 },
  ],
  majorationParPersonneACharge: 1720,
};

/** Part saisissable mensuelle d'un net mensuel (barème annuel ramené au mois). */
export function partSaisissableMensuelle(netMensuel: number, personnesACharge = 0): number {
  if (netMensuel <= 0) return 0;
  const majoration = BAREME_SAISIE.majorationParPersonneACharge * Math.max(0, personnesACharge);
  let reste = netMensuel * 12;
  let precedent = 0;
  let part = 0;
  for (const t of BAREME_SAISIE.tranches) {
    const plafond = t.jusqua === null ? Infinity : t.jusqua + majoration;
    const tranche = Math.min(reste, plafond - precedent);
    if (tranche <= 0) break;
    part += tranche * t.fraction;
    reste -= tranche;
    precedent = plafond;
  }
  return Math.round((part / 12) * 100) / 100;
}
