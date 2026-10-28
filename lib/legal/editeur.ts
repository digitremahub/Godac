/**
 * Identité de l'éditeur de GODAC, reprise dans les mentions légales,
 * les CGU, les CGV, l'accord de sous-traitance (DPA), l'engagement de
 * service (SLA) et le bon de commande.
 *
 * Société en cours d'immatriculation : dès réception du Kbis, renseigner
 * `societe` ici — tous les documents se mettent à jour d'un coup.
 */
export interface Societe {
  raisonSociale: string;
  formeJuridique: string;
  capital: string;
  siret: string;
  rcs: string;
  tva: string;
  adresse: string;
  representant: string;
}

export const EDITEUR = {
  marque: "GODAC",
  prenom: "François",
  email: "contact@godac.fr",
  site: "https://godac.app",
  societe: null as Societe | null,
};

/** Version des documents contractuels, rappelée sur le bon de commande. */
export const VERSION_CONTRATS = "1.2 — octobre 2026";

/** Désignation de l'éditeur dans les contrats (« ci-après l'Éditeur »). */
export function designationEditeur(): string {
  const s = EDITEUR.societe;
  if (!s) return `${EDITEUR.prenom}, éditeur de la solution GODAC (société en cours d'immatriculation)`;
  return `${s.raisonSociale}, ${s.formeJuridique} au capital de ${s.capital}, immatriculée au RCS de ${s.rcs} sous le numéro SIRET ${s.siret}, TVA ${s.tva}, dont le siège est situé ${s.adresse}, représentée par ${s.representant}`;
}

/** Juridiction compétente : celle du siège de l'Éditeur. */
export function juridiction(): string {
  const s = EDITEUR.societe;
  return s ? `le Tribunal de commerce de ${s.rcs}` : "le Tribunal de commerce du ressort du siège de l'Éditeur";
}
