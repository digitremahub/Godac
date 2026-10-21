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
  /** Nom court de la version, affiché dans les réglages (ex. « SMIC du 1er juin 2026 »). */
  libelle?: string;
  /**
   * CSG / CRDS sur les indemnités journalières de Sécurité sociale
   * (revenus de remplacement), reprises sur le bulletin en subrogation.
   */
  ijss?: { csgDeductible: number; csgNonDeductible: number; crds: number };
  /**
   * Sortie du salarié : plafond annuel de la Sécurité sociale (PASS) et
   * contribution patronale spécifique sur la part exonérée de
   * l'indemnité de rupture conventionnelle.
   */
  rupture?: { pass: number; contributionPatronale: number };
}

/**
 * Maintien de salaire en cas d'arrêt (art. L1226-1 et D1226-1 s. du code
 * du travail) : valeurs légales par défaut, remplaçables dans les
 * réglages par les valeurs de la convention collective ou d'un accord.
 */
export interface ParametresMaintien {
  /** Ancienneté minimale (mois) à la date de l'arrêt. */
  ancienneteMinMois: number;
  /** Délai de carence employeur (jours calendaires) — maladie, accident de trajet. */
  carenceMaladie: number;
  /** Délai de carence employeur pour un AT / maladie professionnelle. */
  carenceAt: number;
  /** Taux de la 1re période et de la 2e période (en % de la rémunération). */
  taux1: number;
  taux2: number;
  /** Durée de chaque période (jours) pour l'ancienneté minimale. */
  dureeBase: number;
  /** Jours ajoutés à chaque période par tranche d'ancienneté… */
  dureeIncrement: number;
  /** …de tant d'années au-delà de la première. */
  trancheAnnees: number;
  /** Durée maximale de chaque période (jours). */
  dureeMax: number;
}

/** Nature d'un arrêt ou d'une absence saisie sur le bulletin. */
export type TypeArret = "maladie" | "at_mp" | "trajet" | "maternite" | "paternite" | "sans_solde";

/** Arrêt de travail (ou congé sans solde) — dates incluses. */
export interface ArretTravail {
  /** Ligne de work_stoppages (absent tant qu'il n'est pas enregistré). */
  id?: string;
  type: TypeArret;
  du: string;
  au: string;
  /**
   * Prolongation : date de début de l'arrêt initial. Les délais de
   * carence ne sont pas réappliqués et les durées de maintien courent
   * depuis cette date.
   */
  prolongationDu?: string | null;
  /** IJSS brutes journalières (relevé CPAM), si connues. */
  ijssBrutesJour?: number | null;
  /** IJSS nettes journalières, si connues (sinon brutes − CSG/CRDS). */
  ijssNettesJour?: number | null;
  /** Nombre de jours d'IJSS dans le mois, si connu (sinon calculé). */
  joursIjss?: number | null;
  /** Maintien saisi à la main (remplace le calcul). */
  maintienManuel?: number | null;
}

export type MotifSortie = "licenciement" | "licenciement_faute_grave" | "rupture_conventionnelle" | "demission" | "fin_cdd" | "retraite" | "autre";

/**
 * Éléments du bulletin de sortie, calculés côté serveur
 * (lib/paie/sortie.ts) à partir de employee_exits : jamais repris du
 * navigateur.
 */
export interface ElementsSortie {
  date: string;
  motif: MotifSortie;
  /** Indemnité compensatrice de congés payés (jours acquis non pris). */
  iccp: { jours: number; montant: number; methode: "maintien" | "dixieme" } | null;
  /** Indemnité compensatrice de préavis (préavis non effectué, payé). */
  preavis: { jours: number | null; montant: number } | null;
  /** Indemnité de licenciement ou de rupture conventionnelle. */
  rupture: {
    libelle: string;
    montant: number;
    /** Part exonérée de cotisations sociales. */
    exonereeSocial: number;
    /** Part exonérée d'impôt sur le revenu. */
    exonereeFiscal: number;
    /** Base de la CSG / CRDS (part au-delà de l'indemnité légale). */
    baseCsg: number;
    /** Contribution patronale spécifique (rupture conventionnelle), en %. */
    contributionPatronale: number;
  } | null;
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
  /**
   * Complémentaire santé en % du PMSS (modèle transport : 2,01 % + 2,01 %).
   * Renseigné, il remplace les forfaits `mutuelle`.
   */
  santePmss?: TauxPartage | null;
  /** Cotisations conventionnelles de branche (IDCC 16 : 0,025 % + 0,525 % du brut). */
  conventionnelles?: TauxPartage | null;
  /**
   * Déduction forfaitaire spécifique (DFS, « Abattement 17 % » des
   * conducteurs). Toujours affichée pour mémoire ; appliquée aux bases
   * seulement si `active`.
   */
  dfs?: { taux: number; active: boolean } | null;
  /**
   * Maintien de salaire conventionnel ou d'entreprise (réglages). Absent
   * = maintien légal seul ; renseigné, le plus favorable des deux
   * s'applique jour par jour.
   */
  maintien?: ParametresMaintien | null;
  /** Subrogation : l'employeur perçoit les IJSS et les reverse sur le bulletin. */
  subrogation?: boolean;
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
  /** Groupe conventionnel (ex. 03 bis), affiché sur le bulletin. */
  groupe?: string | null;
  /** Taux du panier repas propre au salarié ; null = réglage de l'entreprise. */
  tauxRepas?: number | null;
  /** Date d'entrée (employee_files.hire_date), pour l'ancienneté du maintien de salaire. */
  dateEntree?: string | null;
}

/** Une période de congés payés pris dans le mois (dates incluses). */
export interface PeriodeConges {
  du: string;
  au: string;
  /** Jours ouvrables décomptés. */
  jours: number;
}

export interface Prime {
  libelle: string;
  montant: number;
  /** false = indemnité non soumise à cotisations (rare, à justifier). */
  soumise: boolean;
}

/**
 * Retenue opérée sur le net à payer (après impôt) : acompte déjà versé,
 * saisie sur salaire (greffe), avis à tiers détenteur / saisie
 * administrative (impôts, Trésor), pension alimentaire (paiement direct),
 * remboursement d'un prêt de l'employeur, autre.
 */
export type TypeRetenue = "acompte" | "saisie" | "atd" | "pension" | "pret" | "autre";

export interface Retenue {
  type: TypeRetenue;
  libelle: string;
  montant: number;
  /** Référence du dossier (n° d'acte, d'avis, créancier) — reprise sur le bulletin. */
  reference?: string;
  /**
   * Acompte venu d'une demande acceptée (salary_advance_requests.id) :
   * ligne ajoutée et relue côté serveur, jamais saisie à la main.
   */
  demandeId?: string;
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
  /** Acomptes, saisies, ATD… déduits du net à payer (absent des bulletins antérieurs). */
  retenues?: Retenue[];
  /** Personnes à charge, pour la part saisissable du salaire. */
  personnesACharge?: number;
  /**
   * Heures supplémentaires saisies (au-delà des heures du contrat). Dès
   * que l'une est renseignée, elles remplacent celles déduites des
   * heures travaillées.
   */
  heuresSup25?: number | null;
  heuresSup50?: number | null;
  /** Congés payés pris avec leurs dates (le total remplace joursCongesPris). */
  periodesConges?: PeriodeConges[];
  /** Taux du panier repas ce mois ; null = profil ou entreprise. */
  tauxRepas?: number | null;
  /** Date de paiement du salaire (AAAA-MM-JJ) ; absente = dernier jour du mois. */
  datePaiement?: string | null;
  /** Mode de paiement du salaire ; absent = virement. */
  modePaiement?: ModePaiement | null;
  /**
   * Type de taux du prélèvement à la source ; absent = personnalisé si un
   * taux est saisi au profil, sinon non personnalisé (grille).
   */
  typeTauxPas?: TypeTauxPas | null;
  /** Arrêts de travail et congés sans solde du mois (work_stoppages). */
  arrets?: ArretTravail[];
  /** Subrogation ce mois ; absent = réglage de l'entreprise. */
  subrogation?: boolean | null;
  /**
   * Cumul brut des bulletins validés de la période de référence des
   * congés (1er juin – 31 mai précédents), pour la règle du dixième.
   * Relu côté serveur ; absent = maintien de salaire seul.
   */
  cpReference?: { brut: number; joursAcquis: number; du: string; au: string } | null;
  /** Bulletin de sortie (calculé côté serveur). */
  sortie?: ElementsSortie | null;
}

export type ModePaiement = "virement" | "cheque" | "especes";

/**
 * Taux du prélèvement à la source : « personnalisé » (transmis par la
 * DGFiP, saisi au profil) ou « non personnalisé » (grille du taux neutre).
 */
export type TypeTauxPas = "personnalise" | "non_personnalise";

/**
 * Rubriques du bulletin clarifié, dans l'ordre d'affichage : Santé, puis
 * Accidents du travail & maladies professionnelles (`at`), puis Retraite…
 */
export type Section = "brut" | "sante" | "at" | "retraite" | "famille" | "chomage" | "autres" | "csg" | "exonerations" | "net";

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
  /** Précision affichée sous le libellé (ex. type de taux du PAS). */
  mention?: string;
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
  /** Type du taux appliqué (absent des bulletins antérieurs). */
  typeTauxPas?: TypeTauxPas;
  montantPas: number;
  fraisNonSoumis: number;
  /** Net à payer avant acomptes et saisies. */
  netAvantRetenues: number;
  totalRetenues: number;
  /** Part saisissable du salaire ce mois (barème légal), pour saisies et ATD. */
  partSaisissable: number;
  /** Net effectivement versé, après acomptes et saisies. */
  netAPayer: number;
  coutEmployeur: number;
  heuresSupExonerees: number;
  /** Net + indemnités non soumises, avant retenues et impôt (« Total dû »). */
  totalDu?: number;
  /** Assiette CSG/CRDS (98,25 % du brut + parts employeur prévoyance et santé). */
  assietteCsg?: number;
  /** Part employeur de santé réintégrée au net imposable. */
  reintegrationSante?: number;
  /** DFS « Abattement 17 % » : montant pour mémoire, et s'il est appliqué. */
  dfs?: { taux: number; montant: number; appliquee: boolean } | null;
  /** Total des cotisations patronales avant réduction générale et déduction HS. */
  totalPatronalHorsReduction?: number;
  /** IJSS brutes réintégrées (subrogation), comprises dans le brut mais pas dans l'assiette. */
  ijssBrutes?: number;
  /** IJSS nettes reversées au salarié (subrogation). */
  ijssNettes?: number;
  /** Indemnité de congés payés retenue ce mois (maintien ou dixième). */
  indemniteCp?: { jours: number; maintien: number; dixieme: number | null; retenue: "maintien" | "dixieme" } | null;
  avertissements: string[];
}
