/**
 * Lecture de la réponse de l'API publique recherche-entreprises
 * (https://recherche-entreprises.api.gouv.fr/search, sans clé), en
 * fonction pure pour être testée sur une réponse type
 * (__tests__/fixtures/recherche-entreprises.json). Lecture défensive :
 * l'API évolue, tout champ peut manquer ou changer de type — on ne
 * garde que ce qui se lit proprement, le reste vaut null.
 */
import { chiffresSeuls } from "@/lib/organization/siret";
import { normaliserIdcc } from "@/lib/organization/idcc";

export const RECHERCHE_ENTREPRISES_URL = "https://recherche-entreprises.api.gouv.fr/search";

export interface InfosEntreprise {
  siren: string;
  /** SIRET de l'établissement trouvé (celui saisi s'il existe, sinon le siège). */
  siret: string | null;
  nom: string;
  /** Raison sociale déclarée (sans le sigle ni l'enseigne). */
  raisonSociale: string | null;
  /** Code NAF/APE sans point, ex. « 4941A ». */
  codeNaf: string | null;
  libelleNaf: string | null;
  formeJuridique: string | null;
  natureJuridique: string | null;
  /** Adresse du siège social (adresse légale). */
  adresseSiege: string | null;
  /** Adresse et position de l'établissement trouvé — le dépôt par défaut. */
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Code INSEE de tranche d'effectif salarié (« 11 » = 10 à 19). */
  trancheEffectif: string | null;
  libelleEffectif: string | null;
  /** Borne basse de la tranche (au moins 1) — pré-remplit l'effectif de la paie. */
  effectifEstime: number | null;
  /** Conventions collectives déclarées, IDCC sur 4 chiffres (« 0016 »). */
  idcc: string[];
  dateCreation: string | null;
  /** Entreprise cessée (etat_administratif = 'C'). */
  cessee: boolean;
}

const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const asNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** « 49.41A » → « 4941A ». */
export function normaliserNaf(code: string | null): string | null {
  if (!code) return null;
  const c = code.replace(/[.\s]/g, "").toUpperCase();
  return /^\d{4}[A-Z]$/.test(c) ? c : null;
}

/** Libellés des codes NAF courants du transport et de la logistique (l'API ne renvoie que le code). */
export const LIBELLES_NAF: Record<string, string> = {
  "4941A": "Transports routiers de fret interurbains",
  "4941B": "Transports routiers de fret de proximité",
  "4941C": "Location de camions avec chauffeur",
  "4942Z": "Services de déménagement",
  "4939A": "Transports routiers réguliers de voyageurs",
  "4939B": "Autres transports routiers de voyageurs",
  "4932Z": "Transports de voyageurs par taxis",
  "5210B": "Entreposage et stockage non frigorifique",
  "5210A": "Entreposage et stockage frigorifique",
  "5229A": "Messagerie, fret express",
  "5229B": "Affrètement et organisation des transports",
  "5320Z": "Autres activités de poste et de courrier",
  "5310Z": "Activités de poste dans le cadre d'une obligation de service universel",
  "7712Z": "Location et location-bail de camions",
};

/** Catégories juridiques INSEE les plus courantes (niveau III). */
export const FORMES_JURIDIQUES: Record<string, string> = {
  "1000": "Entrepreneur individuel",
  "5202": "SNC",
  "5498": "EURL",
  "5499": "SARL",
  "5505": "SA à participation ouvrière",
  "5599": "SA à conseil d'administration",
  "5699": "SA à directoire",
  "5710": "SAS",
  "5720": "SASU",
  "6540": "SCI",
  "5785": "SELAS",
  "9220": "Association déclarée",
};

/** Tranches d'effectif salarié INSEE : libellé et borne basse. */
export const TRANCHES_EFFECTIF: Record<string, { libelle: string; min: number }> = {
  NN: { libelle: "Pas de salarié déclaré", min: 0 },
  "00": { libelle: "0 salarié", min: 0 },
  "01": { libelle: "1 ou 2 salariés", min: 1 },
  "02": { libelle: "3 à 5 salariés", min: 3 },
  "03": { libelle: "6 à 9 salariés", min: 6 },
  "11": { libelle: "10 à 19 salariés", min: 10 },
  "12": { libelle: "20 à 49 salariés", min: 20 },
  "21": { libelle: "50 à 99 salariés", min: 50 },
  "22": { libelle: "100 à 199 salariés", min: 100 },
  "31": { libelle: "200 à 249 salariés", min: 200 },
  "32": { libelle: "250 à 499 salariés", min: 250 },
  "41": { libelle: "500 à 999 salariés", min: 500 },
  "42": { libelle: "1 000 à 1 999 salariés", min: 1000 },
  "51": { libelle: "2 000 à 4 999 salariés", min: 2000 },
  "52": { libelle: "5 000 à 9 999 salariés", min: 5000 },
  "53": { libelle: "10 000 salariés et plus", min: 10000 },
};

function idccDe(...sources: unknown[]): string[] {
  const out = new Set<string>();
  for (const src of sources) {
    for (const v of asArray(src)) {
      const n = normaliserIdcc(asString(v));
      if (n) out.add(n);
    }
  }
  return [...out];
}

/**
 * Première entreprise de la réponse, lue autour de l'établissement
 * saisi : pour un SIRET, l'établissement correspondant de
 * `matching_etablissements` (sinon le siège) ; pour un SIREN, le siège.
 * null quand la réponse ne contient aucune entreprise exploitable.
 */
export function lireReponseRechercheEntreprises(json: unknown, saisie: string): InfosEntreprise | null {
  const racine = asObject(json);
  const premier = asObject(asArray(racine?.results)[0]);
  if (!premier) return null;
  const siren = chiffresSeuls(asString(premier.siren) ?? "");
  if (siren.length !== 9) return null;

  const saisi = chiffresSeuls(saisie);
  const siege = asObject(premier.siege);
  const etablissements = asArray(premier.matching_etablissements).map(asObject).filter((e): e is Record<string, unknown> => e !== null);
  const etab =
    (saisi.length === 14 ? etablissements.find((e) => chiffresSeuls(asString(e.siret) ?? "") === saisi) : undefined) ??
    (saisi.length === 14 && siege && chiffresSeuls(asString(siege.siret) ?? "") === saisi ? siege : undefined) ??
    siege ??
    etablissements[0] ??
    null;

  const complements = asObject(premier.complements);
  const codeNaf = normaliserNaf(asString(premier.activite_principale) ?? asString(etab?.activite_principale));
  const libelleNafApi = asString(premier.libelle_activite_principale) ?? asString(etab?.libelle_activite_principale);
  const nature = asString(premier.nature_juridique);
  const tranche = asString(premier.tranche_effectif_salarie) ?? asString(etab?.tranche_effectif_salarie);
  const trancheInfo = tranche ? TRANCHES_EFFECTIF[tranche] : undefined;
  const siretEtab = chiffresSeuls(asString(etab?.siret) ?? "");

  return {
    siren,
    siret: siretEtab.length === 14 ? siretEtab : saisi.length === 14 ? saisi : null,
    nom: asString(premier.nom_complet) ?? asString(premier.nom_raison_sociale) ?? siren,
    raisonSociale: asString(premier.nom_raison_sociale),
    codeNaf,
    libelleNaf: libelleNafApi ?? (codeNaf ? (LIBELLES_NAF[codeNaf] ?? null) : null),
    formeJuridique: nature ? (FORMES_JURIDIQUES[nature] ?? null) : null,
    natureJuridique: nature,
    adresseSiege: asString(siege?.adresse) ?? asString(etab?.adresse),
    adresse: asString(etab?.adresse),
    codePostal: asString(etab?.code_postal),
    ville: asString(etab?.libelle_commune),
    latitude: asNumber(etab?.latitude),
    longitude: asNumber(etab?.longitude),
    trancheEffectif: tranche,
    libelleEffectif: trancheInfo?.libelle ?? null,
    effectifEstime: trancheInfo ? Math.max(1, trancheInfo.min) : null,
    idcc: idccDe(complements?.liste_idcc, etab?.liste_idcc, siege?.liste_idcc),
    dateCreation: asString(premier.date_creation),
    cessee: asString(premier.etat_administratif) === "C",
  };
}
