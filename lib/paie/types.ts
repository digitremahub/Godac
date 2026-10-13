/**
 * Moteur de paie GODAC — types partagés entre le calcul (lib/paie/calcul.ts),
 * les paramètres légaux (lib/paie/parametres.ts), l'écran de préparation
 * et le PDF. Tous les montants sont en euros, les taux en pourcentage
 * (6.9 = 6,90 %), les heures en heures décimales.
 */

export type RegimeTransport =
  /** Conducteurs « grands routiers » : durée d'équivalence 43 h/semaine. */
  | "grand_routier"
  /** Conducteurs « courte distance » : durée d'équivalence 39 h/semaine. */
  | "courte_distance"
  /** Personnel sédentaire, durée légale 35 h/semaine. */
  | "sedentaire";

/** Une ligne de taux légal, répartie entre salarié et employeur. */
export interface TauxPartage {
  salarial: number;
  patronal: number;
}

/** Paramètres légaux d'une période (un jeu par date d'effet). */
export interface ParametresLegaux {
  /** Date à partir de laquelle ce jeu s'applique (AAAA-MM-JJ). */
  effetAu: string;
  smicHoraire: number;
  pmss: number;
  maladie: { normal: number; reduit: number; seuilReduitSmic: number };
  vieillessePlafonnee: TauxPartage;
  vieillesseDeplafonnee: TauxPartage;
  allocationsFamiliales: { normal: number; reduit: number; seuilReduitSmic: number };
  csa: number;
  fnal: { moins50: number; auMoins50: number };
  chomage: number;
  ags: number;
  agircArrcoT1: TauxPartage;
  cegT1: TauxPartage;
  agircArrcoT2: TauxPartage;
  cegT2: TauxPartage;
  cet: TauxPartage;
  apec: TauxPartage;
  prevoyanceCadreMinT1: number;
  csgDeductible: number;
  csgNonDeductible: number;
  crds: number;
  /** Part du brut soumise à CSG/CRDS (abattement frais professionnels). */
  assietteCsgPart: number;
  dialogueSocial: number;
  formationPro: { moins11: number; auMoins11: number };
  taxeApprentissage: number;
  heuresSup: {
    reductionSalariale: number;
    plafondExonerationIrAnnuel: number;
    deductionPatronaleParHeure: { moins20: number; de20a249: number };
  };
  /** Réduction générale des cotisations patronales (RGDU depuis 2026). */
  reductionGenerale: {
    /** SMIC horaire de référence de la formule (celui du 1er janvier pour 2026). */
    smicHoraireReference: number;
    /** Plafond d'éligibilité, en multiple du SMIC de référence. */
    plafondSmic: number;
    tMin: number;
    tDelta: { fnal010: number; fnal050: number };
    puissance: number;
  };
  /** Grille du taux neutre du prélèvement à la source (métropole), mensuelle. */
  tauxNeutrePas: { jusqua: number | null; taux: number }[];
}

/** Paramètres propres à l'entreprise (saisis une fois). */
export interface ParametresEntreprise {
  effectif: number;
  tauxAccidentTravail: number;
  tauxVersementMobilite: number;
  /** Prévoyance conventionnelle (ex. CARCEPT Prévoyance), en % de la T1. */
  prevoyance: TauxPartage;
  /** Complémentaire santé obligatoire, montants mensuels forfaitaires. */
  mutuelle: { salarial: number; patronal: number };
  /** Frais de déplacement conventionnels (montants unitaires, non soumis dans les limites URSSAF). */
  frais: { repas: number; repasUnique: number; cassecroute: number; grandDeplacement: number };
}

export interface ProfilSalarie {
  regime: RegimeTransport;
  cadre: boolean;
  /** Taux horaire brut de base (grille conventionnelle ou contrat). */
  tauxHoraire: number;
  /** Heures mensuelles payées au contrat (151,67 / 169 / 186…). */
  heuresContractuelles: number;
  /** Taux personnalisé de prélèvement à la source ; null = taux neutre. */
  tauxPas: number | null;
}

export interface Prime {
  libelle: string;
  montant: number;
  /** false = indemnité non soumise à cotisations (rare, à justifier). */
  soumise: boolean;
}

export interface VariablesMois {
  /** Heures réellement travaillées (tournées / badges) ; null = heures du contrat. */
  heuresTravaillees: number | null;
  /** Heures d'absence non rémunérée à déduire. */
  heuresAbsenceNonPayee: number;
  joursCongesPris: number;
  primes: Prime[];
  nbRepas: number;
  nbRepasUnique: number;
  nbCasseCroute: number;
  nbGrandDeplacement: number;
  /** Cumul d'heures sup déjà exonérées d'IR cette année (pour le plafond). */
  cumulHeuresSupExonereesAnnee: number;
}

export type Section = "brut" | "sante" | "retraite" | "famille" | "chomage" | "autres" | "csg" | "exonerations" | "net";

export interface LigneBulletin {
  section: Section;
  libelle: string;
  base: number | null;
  tauxSalarial: number | null;
  montantSalarial: number | null;
  tauxPatronal: number | null;
  montantPatronal: number | null;
  /** Ligne de gain (brut, frais) plutôt que de retenue. */
  gain?: boolean;
}

export interface Bulletin {
  lignes: LigneBulletin[];
  heures: { base: number; sup25: number; sup50: number; absence: number };
  brut: number;
  totalSalarial: number;
  totalPatronal: number;
  reductionGenerale: number;
  netAvantImpot: number;
  netSocial: number;
  netImposable: number;
  tauxPas: number;
  montantPas: number;
  fraisNonSoumis: number;
  netAPayer: number;
  coutEmployeur: number;
  heuresSupExonerees: number;
  avertissements: string[];
}
