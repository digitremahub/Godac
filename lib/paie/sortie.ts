import { ancienneteMois } from "@/lib/paie/arrets";
import type { ElementsSortie, MotifSortie, ParametresLegaux } from "@/lib/paie/types";

// Sortie d'un salarié — logique pure, testée dans
// lib/paie/__tests__/sortie.test.ts. Règles simplifiées, à faire valider
// par le comptable (voir les commentaires de chaque fonction).

export const LIBELLE_MOTIF: Record<MotifSortie, string> = {
  licenciement: "Licenciement",
  licenciement_faute_grave: "Licenciement pour faute grave ou lourde",
  rupture_conventionnelle: "Rupture conventionnelle",
  demission: "Démission",
  fin_cdd: "Fin de contrat à durée déterminée",
  retraite: "Départ à la retraite",
  autre: "Autre motif",
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Ancienneté en années, mois complets compris (année incomplète au prorata des mois, art. R1234-1). */
export function ancienneteAnnees(entree: string, sortie: string): number {
  return Math.floor((ancienneteMois(entree, sortie) / 12) * 10000) / 10000;
}

export interface IndemniteLicenciement {
  /** Au moins 8 mois d'ancienneté ininterrompue (art. L1234-9). */
  eligible: boolean;
  anciennete: number;
  /** Moyenne des 12 derniers mois et des 3 derniers mois. */
  moyenne12: number;
  moyenne3: number;
  salaireReference: number;
  montant: number;
}

/**
 * Indemnité légale de licenciement (art. R1234-1 à R1234-4) : 1/4 de mois
 * de salaire par année jusqu'à 10 ans, 1/3 au-delà, sur le salaire de
 * référence le plus favorable entre la moyenne des 12 et des 3 derniers
 * mois. Simplifications : les salaires bruts mensuels sont ceux des
 * bulletins validés (les primes annuelles ne sont pas proratisées dans
 * la moyenne des 3 mois) ; l'ancienneté s'arrête à la date de sortie
 * saisie (fin du préavis, effectué ou non).
 */
export function indemniteLegaleLicenciement(params: { entree: string; sortie: string; salairesMensuels: number[] }): IndemniteLicenciement {
  const mois = ancienneteMois(params.entree, params.sortie);
  const anciennete = ancienneteAnnees(params.entree, params.sortie);
  const salaires = params.salairesMensuels.filter((s) => s > 0);
  const moyenne = (l: number[]) => (l.length ? l.reduce((t, s) => t + s, 0) / l.length : 0);
  const moyenne12 = r2(moyenne(salaires.slice(-12)));
  const moyenne3 = r2(moyenne(salaires.slice(-3)));
  const salaireReference = Math.max(moyenne12, moyenne3);
  const eligible = mois >= 8;
  const montant = eligible ? r2(salaireReference * (Math.min(anciennete, 10) / 4 + Math.max(0, anciennete - 10) / 3)) : 0;
  return { eligible, anciennete, moyenne12, moyenne3, salaireReference, montant };
}

export interface IndemniteConges {
  jours: number;
  maintien: number;
  dixieme: number | null;
  montant: number;
  methode: "maintien" | "dixieme";
}

/**
 * Indemnité de congés payés (art. L3141-24) : la plus favorable entre le
 * maintien de salaire (salaire mensuel ÷ 26 par jour ouvrable, comme sur
 * le bulletin) et le dixième de la rémunération brute de référence, au
 * prorata des jours (dixième × jours ÷ jours acquis sur cette période).
 * Sans cumuls de référence : maintien seul.
 */
export function indemniteConges(params: { jours: number; salaireMensuel: number; reference: { brut: number; joursAcquis: number } | null }): IndemniteConges {
  const jours = Math.max(0, params.jours);
  const maintien = r2(jours * r2(params.salaireMensuel / 26));
  const ref = params.reference;
  const dixieme = ref && ref.brut > 0 && ref.joursAcquis > 0 ? r2((ref.brut * 0.1 * jours) / ref.joursAcquis) : null;
  const methode = dixieme !== null && dixieme > maintien ? "dixieme" : "maintien";
  return { jours, maintien, dixieme, montant: methode === "dixieme" ? dixieme! : maintien, methode };
}

/**
 * Traitement social et fiscal SIMPLIFIÉ d'une indemnité de rupture (à
 * vérifier par le comptable) :
 * - exonération d'impôt : la plus élevée de l'indemnité légale, de 2 fois
 *   la rémunération annuelle brute de l'année précédente ou de 50 % de
 *   l'indemnité, dans la limite de 6 PASS (art. 80 duodecies CGI) ;
 * - exonération de cotisations : la part exonérée d'impôt, dans la
 *   limite de 2 PASS ; aucune au-delà de 10 PASS ;
 * - CSG / CRDS : sur la part qui dépasse l'indemnité légale ;
 * - rupture conventionnelle : contribution patronale spécifique sur la
 *   part exonérée de cotisations.
 */
export function traitementRupture(params: {
  motif: MotifSortie;
  montant: number;
  indemniteLegale: number;
  remunerationAnnuellePrecedente: number;
  legal: Pick<ParametresLegaux, "rupture">;
}): NonNullable<ElementsSortie["rupture"]> {
  const pass = params.legal.rupture?.pass ?? 48060;
  const montant = r2(Math.max(0, params.montant));
  const legale = Math.min(params.indemniteLegale, montant);
  const exonereeFiscal = r2(Math.min(montant, Math.max(legale, Math.min(Math.max(2 * params.remunerationAnnuellePrecedente, 0.5 * montant), 6 * pass))));
  const exonereeSocial = montant > 10 * pass ? 0 : r2(Math.min(exonereeFiscal, 2 * pass));
  const baseCsg = r2(Math.max(0, montant - Math.min(legale, exonereeSocial)));
  const rc = params.motif === "rupture_conventionnelle";
  return {
    libelle: rc ? "Indemnité spécifique de rupture conventionnelle" : "Indemnité de licenciement",
    montant,
    exonereeSocial,
    exonereeFiscal,
    baseCsg,
    contributionPatronale: rc ? (params.legal.rupture?.contributionPatronale ?? 40) : 0,
  };
}

export interface DonneesSortie {
  date: string;
  motif: MotifSortie;
  entree: string | null;
  /** Préavis : effectué (payé normalement), payé (indemnité compensatrice), dispensé sans paiement ou sans objet. */
  preavis: { type: "effectue" | "paye" | "non_paye" | "sans"; jours: number | null; montant: number | null };
  /** Montant convenu (rupture conventionnelle) ou supra-légal (licenciement), saisi. */
  montantRupture: number | null;
  /** Jours de CP acquis non pris à la date de sortie. */
  joursCpRestants: number;
  salaireMensuel: number;
  salairesMensuels: number[];
  remunerationAnnuellePrecedente: number;
  referenceCp: { brut: number; joursAcquis: number } | null;
}

/** Éléments du bulletin de sortie et avertissements. */
export function calculerSortie(d: DonneesSortie, legal: Pick<ParametresLegaux, "rupture">): { elements: ElementsSortie; licenciement: IndemniteLicenciement | null; conges: IndemniteConges; avertissements: string[] } {
  const avertissements: string[] = [];
  const conges = indemniteConges({ jours: d.joursCpRestants, salaireMensuel: d.salaireMensuel, reference: d.referenceCp });
  const licenciement = d.entree ? indemniteLegaleLicenciement({ entree: d.entree, sortie: d.date, salairesMensuels: d.salairesMensuels }) : null;
  if (!d.entree && (d.motif === "licenciement" || d.motif === "rupture_conventionnelle")) avertissements.push("Date d'entrée inconnue : indemnité légale non calculée (dossier salarié).");

  let preavis: ElementsSortie["preavis"] = null;
  if (d.preavis.type === "paye") {
    const montant = d.preavis.montant ?? (d.preavis.jours ? r2((d.salaireMensuel * d.preavis.jours) / 30) : 0);
    if (montant > 0) preavis = { jours: d.preavis.jours, montant: r2(montant) };
    if (!d.preavis.montant && d.preavis.jours) avertissements.push("Indemnité de préavis estimée à salaire mensuel × jours ÷ 30 : saisissez le montant exact si besoin.");
  }

  let rupture: ElementsSortie["rupture"] = null;
  const legale = licenciement?.montant ?? 0;
  if (d.motif === "licenciement") {
    const montant = Math.max(legale, d.montantRupture ?? 0);
    if (montant > 0) rupture = traitementRupture({ motif: d.motif, montant, indemniteLegale: legale, remunerationAnnuellePrecedente: d.remunerationAnnuellePrecedente, legal });
    if (licenciement && !licenciement.eligible) avertissements.push("Moins de 8 mois d'ancienneté : pas d'indemnité légale de licenciement.");
  } else if (d.motif === "rupture_conventionnelle") {
    const montant = d.montantRupture ?? 0;
    if (montant < legale - 0.005) {
      avertissements.push(`Indemnité de rupture conventionnelle (${montant.toFixed(2)} €) inférieure à l'indemnité légale de licenciement (${legale.toFixed(2)} €) : elle ne peut pas être inférieure.`);
    }
    if (montant > 0) rupture = traitementRupture({ motif: d.motif, montant, indemniteLegale: legale, remunerationAnnuellePrecedente: d.remunerationAnnuellePrecedente, legal });
  } else if (d.motif === "retraite") {
    avertissements.push("Départ à la retraite : indemnité conventionnelle de départ non calculée, à saisir en prime.");
  }
  if (rupture) avertissements.push("Traitement social et fiscal de l'indemnité de rupture simplifié : à vérifier par le comptable.");

  return {
    elements: {
      date: d.date,
      motif: d.motif,
      iccp: conges.jours > 0 ? { jours: conges.jours, montant: conges.montant, methode: conges.methode } : null,
      preavis,
      rupture,
    },
    licenciement,
    conges,
    avertissements,
  };
}
