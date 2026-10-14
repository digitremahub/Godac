/**
 * Ce que la lecture d'un SIRET propose d'écrire sur l'organisation, et
 * ce qui demande confirmation. Règle : un champ vide se remplit
 * d'office ; un champ déjà renseigné avec une autre valeur n'est
 * remplacé que si la direction l'a coché (jamais d'écrasement
 * silencieux). Fonction pure, utilisée à l'identique par l'écran
 * (aperçu) et par la route qui écrit (avec les valeurs fraîches de la
 * base, pas celles envoyées par le navigateur).
 */
import type { InfosEntreprise } from "@/lib/organization/recherche-entreprises";
import { texteConventionCollective } from "@/lib/organization/idcc";

export type CleFiche =
  | "legal_name"
  | "siret"
  | "siren"
  | "legal_form"
  | "ape_code"
  | "naf_label"
  | "legal_address"
  | "convention_collective"
  | "idcc"
  | "effectif_tranche"
  | "company_created_on"
  | "depot_address"
  | "country";

export const CLES_FICHE: CleFiche[] = [
  "legal_name",
  "siret",
  "siren",
  "legal_form",
  "ape_code",
  "naf_label",
  "legal_address",
  "convention_collective",
  "idcc",
  "effectif_tranche",
  "company_created_on",
  "depot_address",
  "country",
];

export const LIBELLES_FICHE: Record<CleFiche, string> = {
  legal_name: "Raison sociale",
  siret: "SIRET",
  siren: "SIREN",
  legal_form: "Forme juridique",
  ape_code: "Code APE/NAF",
  naf_label: "Activité principale",
  legal_address: "Adresse légale (siège social)",
  convention_collective: "Convention collective",
  idcc: "IDCC",
  effectif_tranche: "Tranche d'effectif",
  company_created_on: "Date de création",
  depot_address: "Adresse du dépôt",
  country: "Pays",
};

export type ValeurFiche = string | string[] | null;

export interface ChampFiche {
  cle: CleFiche;
  libelle: string;
  actuel: string | null;
  propose: string;
  /** vide : rempli d'office ; identique : rien à faire ; different : remplacé seulement si confirmé. */
  etat: "vide" | "identique" | "different";
}

/** Valeurs à écrire, colonne par colonne, depuis la fiche SIRENE. */
export function valeursFiche(info: InfosEntreprise): Record<CleFiche, ValeurFiche> {
  return {
    legal_name: info.raisonSociale ?? info.nom,
    siret: info.siret,
    siren: info.siren,
    legal_form: info.formeJuridique,
    ape_code: info.codeNaf,
    naf_label: info.libelleNaf,
    legal_address: info.adresseSiege,
    convention_collective: texteConventionCollective(info.idcc),
    idcc: info.idcc.length > 0 ? info.idcc : null,
    effectif_tranche: info.trancheEffectif,
    company_created_on: info.dateCreation,
    depot_address: info.adresse,
    country: "FR",
  };
}

function texte(v: unknown): string | null {
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : null;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Comparaison tolérante : casse, espaces et ponctuation des identifiants ne comptent pas. */
function memeValeur(cle: CleFiche, a: string, b: string): boolean {
  const norm = (s: string) =>
    cle === "siret" || cle === "siren" || cle === "ape_code" ? s.replace(/[\s.]/g, "").toUpperCase() : s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

export function comparerFiche(actuel: Partial<Record<CleFiche, unknown>>, info: InfosEntreprise): ChampFiche[] {
  const valeurs = valeursFiche(info);
  const champs: ChampFiche[] = [];
  for (const cle of CLES_FICHE) {
    const propose = texte(valeurs[cle]);
    if (!propose) continue;
    const courant = texte(actuel[cle]);
    champs.push({
      cle,
      libelle: LIBELLES_FICHE[cle],
      actuel: courant,
      propose,
      etat: !courant ? "vide" : memeValeur(cle, courant, propose) ? "identique" : "different",
    });
  }
  return champs;
}

/** Colonnes à écrire : les champs vides, plus les champs différents que la direction a confirmés. */
export function champsAEcrire(champs: ChampFiche[], remplacer: readonly string[]): CleFiche[] {
  return champs.filter((c) => c.etat === "vide" || (c.etat === "different" && remplacer.includes(c.cle))).map((c) => c.cle);
}
