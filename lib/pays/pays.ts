/**
 * Pays de l'entreprise et règles qui en découlent dans GODAC : loi de
 * protection des données et autorité de contrôle, temps de conduite,
 * organismes de paie, identifiants légaux, monnaie.
 *
 * Le calcul complet des bulletins de paie (lib/paie) ne couvre que la
 * France : ailleurs, GODAC ne produit pas de bulletin plutôt que d'en
 * produire un faux, et oriente vers le gestionnaire de paie local.
 */
export type CodePays = "FR" | "BE" | "LU" | "CH" | "DE" | "ES" | "IT" | "PT" | "NL" | "GB" | "MA" | "TN" | "DZ";

export interface Pays {
  code: CodePays;
  nom: string;
  drapeau: string;
  devise: "EUR" | "CHF" | "GBP" | "MAD" | "TND" | "DZD";
  locale: string;
  fuseau: string;
  indicatif: string;
  /** Membre de l'UE / EEE : le RGPD s'applique directement. */
  ue: boolean;
  donnees: {
    loi: string;
    autorite: string;
    site: string;
    /** Formalité particulière liée à l'hébergement des données en France (hors UE). */
    transfert: string | null;
  };
  tempsConduite: string;
  paie: {
    /** Bulletins calculés par le moteur GODAC (lib/paie). */
    moteur: boolean;
    organismes: string;
  };
  identifiants: {
    entreprise: string;
    exempleEntreprise: string;
    cotisant: string;
  };
}

const RTE_UE = "Règlement (CE) n° 561/2006 (temps de conduite et de repos) et chronotachygraphe — Règlement (UE) n° 165/2014";

export const PAYS: Pays[] = [
  {
    code: "FR",
    nom: "France",
    drapeau: "🇫🇷",
    devise: "EUR",
    locale: "fr-FR",
    fuseau: "Europe/Paris",
    indicatif: "+33",
    ue: true,
    donnees: { loi: "RGPD et loi Informatique et Libertés", autorite: "CNIL", site: "https://www.cnil.fr", transfert: null },
    tempsConduite: `${RTE_UE}, Code des transports`,
    paie: { moteur: true, organismes: "URSSAF, retraite complémentaire Agirc-Arrco, prélèvement à la source (DGFiP), DSN" },
    identifiants: { entreprise: "SIRET", exempleEntreprise: "804 467 967 00027", cotisant: "Numéro de cotisant URSSAF" },
  },
  {
    code: "BE",
    nom: "Belgique",
    drapeau: "🇧🇪",
    devise: "EUR",
    locale: "fr-BE",
    fuseau: "Europe/Brussels",
    indicatif: "+32",
    ue: true,
    donnees: { loi: "RGPD et loi du 30 juillet 2018", autorite: "Autorité de protection des données (APD)", site: "https://www.autoriteprotectiondonnees.be", transfert: null },
    tempsConduite: RTE_UE,
    paie: { moteur: false, organismes: "ONSS, précompte professionnel (SPF Finances), généralement via un secrétariat social" },
    identifiants: { entreprise: "Numéro d'entreprise (BCE)", exempleEntreprise: "0123.456.789", cotisant: "Numéro d'employeur ONSS" },
  },
  {
    code: "LU",
    nom: "Luxembourg",
    drapeau: "🇱🇺",
    devise: "EUR",
    locale: "fr-LU",
    fuseau: "Europe/Luxembourg",
    indicatif: "+352",
    ue: true,
    donnees: { loi: "RGPD et loi du 1er août 2018", autorite: "Commission nationale pour la protection des données (CNPD)", site: "https://cnpd.public.lu", transfert: null },
    tempsConduite: RTE_UE,
    paie: { moteur: false, organismes: "Centre commun de la sécurité sociale (CCSS), retenue d'impôt (ACD)" },
    identifiants: { entreprise: "Numéro RCS", exempleEntreprise: "B123456", cotisant: "Matricule employeur CCSS" },
  },
  {
    code: "CH",
    nom: "Suisse",
    drapeau: "🇨🇭",
    devise: "CHF",
    locale: "fr-CH",
    fuseau: "Europe/Zurich",
    indicatif: "+41",
    ue: false,
    donnees: {
      loi: "Loi fédérale sur la protection des données (nLPD)",
      autorite: "Préposé fédéral à la protection des données et à la transparence (PFPDT)",
      site: "https://www.edoeb.admin.ch",
      transfert: "La France est reconnue par la Suisse comme offrant une protection adéquate : pas d'autorisation nécessaire, mais le transfert doit figurer dans votre registre des traitements.",
    },
    tempsConduite: "Ordonnance sur les chauffeurs (OTR 1), alignée sur le Règlement (CE) n° 561/2006",
    paie: { moteur: false, organismes: "Caisse de compensation AVS/AI/APG, assurance-chômage, prévoyance professionnelle (LPP), LAA" },
    identifiants: { entreprise: "Numéro IDE", exempleEntreprise: "CHE-123.456.789", cotisant: "Numéro d'affilié à la caisse AVS" },
  },
  {
    code: "DE",
    nom: "Allemagne",
    drapeau: "🇩🇪",
    devise: "EUR",
    locale: "de-DE",
    fuseau: "Europe/Berlin",
    indicatif: "+49",
    ue: true,
    donnees: { loi: "RGPD (DSGVO) et BDSG", autorite: "Autorité de protection des données du Land (liste sur le site du BfDI)", site: "https://www.bfdi.bund.de", transfert: null },
    tempsConduite: `${RTE_UE}, Fahrpersonalgesetz`,
    paie: { moteur: false, organismes: "Caisses de sécurité sociale (Krankenkassen), Lohnsteuer (Finanzamt)" },
    identifiants: { entreprise: "Numéro au registre du commerce (HRB)", exempleEntreprise: "HRB 12345", cotisant: "Betriebsnummer" },
  },
  {
    code: "ES",
    nom: "Espagne",
    drapeau: "🇪🇸",
    devise: "EUR",
    locale: "es-ES",
    fuseau: "Europe/Madrid",
    indicatif: "+34",
    ue: true,
    donnees: { loi: "RGPD et LOPDGDD (Ley Orgánica 3/2018)", autorite: "Agencia Española de Protección de Datos (AEPD)", site: "https://www.aepd.es", transfert: null },
    tempsConduite: RTE_UE,
    paie: { moteur: false, organismes: "Seguridad Social (Sistema RED), IRPF (Agencia Tributaria)" },
    identifiants: { entreprise: "NIF / CIF", exempleEntreprise: "B12345678", cotisant: "Código de cuenta de cotización" },
  },
  {
    code: "IT",
    nom: "Italie",
    drapeau: "🇮🇹",
    devise: "EUR",
    locale: "it-IT",
    fuseau: "Europe/Rome",
    indicatif: "+39",
    ue: true,
    donnees: { loi: "RGPD et Codice privacy (D.Lgs. 196/2003)", autorite: "Garante per la protezione dei dati personali", site: "https://www.garanteprivacy.it", transfert: null },
    tempsConduite: RTE_UE,
    paie: { moteur: false, organismes: "INPS, INAIL, IRPEF ; Libro unico del lavoro" },
    identifiants: { entreprise: "Partita IVA", exempleEntreprise: "12345678901", cotisant: "Matricola INPS" },
  },
  {
    code: "PT",
    nom: "Portugal",
    drapeau: "🇵🇹",
    devise: "EUR",
    locale: "pt-PT",
    fuseau: "Europe/Lisbon",
    indicatif: "+351",
    ue: true,
    donnees: { loi: "RGPD et Lei n.º 58/2019", autorite: "Comissão Nacional de Proteção de Dados (CNPD)", site: "https://www.cnpd.pt", transfert: null },
    tempsConduite: RTE_UE,
    paie: { moteur: false, organismes: "Segurança Social, IRS (Autoridade Tributária)" },
    identifiants: { entreprise: "NIPC", exempleEntreprise: "501234567", cotisant: "NISS de l'employeur" },
  },
  {
    code: "NL",
    nom: "Pays-Bas",
    drapeau: "🇳🇱",
    devise: "EUR",
    locale: "nl-NL",
    fuseau: "Europe/Amsterdam",
    indicatif: "+31",
    ue: true,
    donnees: { loi: "RGPD (AVG) et UAVG", autorite: "Autoriteit Persoonsgegevens", site: "https://www.autoriteitpersoonsgegevens.nl", transfert: null },
    tempsConduite: RTE_UE,
    paie: { moteur: false, organismes: "Belastingdienst (loonheffingen), UWV" },
    identifiants: { entreprise: "Numéro KvK", exempleEntreprise: "12345678", cotisant: "Loonheffingennummer" },
  },
  {
    code: "GB",
    nom: "Royaume-Uni",
    drapeau: "🇬🇧",
    devise: "GBP",
    locale: "en-GB",
    fuseau: "Europe/London",
    indicatif: "+44",
    ue: false,
    donnees: {
      loi: "UK GDPR et Data Protection Act 2018",
      autorite: "Information Commissioner's Office (ICO)",
      site: "https://ico.org.uk",
      transfert: "Le Royaume-Uni reconnaît l'Union européenne comme adéquate : l'hébergement en France est autorisé. Pensez à l'enregistrement annuel auprès de l'ICO (data protection fee).",
    },
    tempsConduite: "Règles de temps de conduite britanniques reprenant le Règlement (CE) n° 561/2006 (assimilated law)",
    paie: { moteur: false, organismes: "HMRC (PAYE, National Insurance), Real Time Information" },
    identifiants: { entreprise: "Company number (Companies House)", exempleEntreprise: "01234567", cotisant: "Employer PAYE reference" },
  },
  {
    code: "MA",
    nom: "Maroc",
    drapeau: "🇲🇦",
    devise: "MAD",
    locale: "fr-MA",
    fuseau: "Africa/Casablanca",
    indicatif: "+212",
    ue: false,
    donnees: {
      loi: "Loi n° 09-08 relative à la protection des personnes physiques à l'égard des données à caractère personnel",
      autorite: "Commission nationale de contrôle de la protection des données (CNDP)",
      site: "https://www.cndp.ma",
      transfert: "Les traitements doivent être déclarés à la CNDP, et le transfert vers la France (hébergement GODAC) déclaré ou autorisé selon ses règles.",
    },
    tempsConduite: "Réglementation nationale du transport routier (Code de la route, loi n° 52-05)",
    paie: { moteur: false, organismes: "CNSS, AMO, impôt sur le revenu (DGI)" },
    identifiants: { entreprise: "ICE", exempleEntreprise: "001234567000089", cotisant: "Numéro d'affiliation CNSS" },
  },
  {
    code: "TN",
    nom: "Tunisie",
    drapeau: "🇹🇳",
    devise: "TND",
    locale: "fr-TN",
    fuseau: "Africa/Tunis",
    indicatif: "+216",
    ue: false,
    donnees: {
      loi: "Loi organique n° 2004-63 portant sur la protection des données à caractère personnel",
      autorite: "Instance nationale de protection des données personnelles (INPDP)",
      site: "https://www.inpdp.tn",
      transfert: "Les traitements doivent être déclarés à l'INPDP, et le transfert vers l'étranger (hébergement en France) autorisé par elle.",
    },
    tempsConduite: "Réglementation nationale du transport routier",
    paie: { moteur: false, organismes: "CNSS, impôt sur le revenu (IRPP)" },
    identifiants: { entreprise: "Matricule fiscal", exempleEntreprise: "1234567/A/M/000", cotisant: "Numéro d'employeur CNSS" },
  },
  {
    code: "DZ",
    nom: "Algérie",
    drapeau: "🇩🇿",
    devise: "DZD",
    locale: "fr-DZ",
    fuseau: "Africa/Algiers",
    indicatif: "+213",
    ue: false,
    donnees: {
      loi: "Loi n° 18-07 du 10 juin 2018 relative à la protection des personnes physiques dans le traitement des données à caractère personnel",
      autorite: "Autorité nationale de protection des données à caractère personnel (ANPDP)",
      site: "https://anpdp.dz",
      transfert: "Les traitements doivent être déclarés à l'ANPDP, et le transfert vers l'étranger (hébergement en France) autorisé par elle.",
    },
    tempsConduite: "Réglementation nationale du transport routier",
    paie: { moteur: false, organismes: "CNAS, CASNOS, IRG" },
    identifiants: { entreprise: "NIF / Registre du commerce", exempleEntreprise: "000016001234567", cotisant: "Numéro d'employeur CNAS" },
  },
];

export const PAYS_DEFAUT: CodePays = "FR";

export function paysDe(code: string | null | undefined): Pays {
  return PAYS.find((p) => p.code === code) ?? PAYS.find((p) => p.code === PAYS_DEFAUT)!;
}

/** Modules dont le contenu est propre au droit français. */
const MODULES_FRANCE = ["ticpe_export"] as const;

/** Le module est-il proposé aux entreprises de ce pays ? */
export function moduleDisponible(code: string | null | undefined, moduleKey: string): boolean {
  return paysDe(code).code === "FR" || !(MODULES_FRANCE as readonly string[]).includes(moduleKey);
}

/** Raison affichée à côté d'un module indisponible. */
export function raisonIndisponible(moduleKey: string): string | null {
  return moduleKey === "ticpe_export" ? "Remboursement de TICPE : dispositif fiscal français." : null;
}
