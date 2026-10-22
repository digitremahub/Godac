/**
 * Éligibilité TICPE d'un véhicule, datée et expliquée — pur, testé.
 *
 * Statut : ✅ éligible, ⚠️ à vérifier (compté, mais un point est à
 * régler avant la déclaration), ❌ exclu (jamais compté). Chaque statut
 * vient avec ses raisons, et une période d'éligibilité (entrée / sortie
 * de flotte, début / fin de location).
 *
 * Règles (modèle standard, à confirmer par l'expert-comptable là où
 * c'est indiqué) :
 *  - marchandises (TRM) : PL/SPL de PTAC ≥ 7,5 t ; voyageurs (TRV) :
 *    PL/SPL (autocars) ; taxi : véhicule léger admis. VL/VUL jamais
 *    éligibles hors taxi. L'activité doit être cochée dans les réglages.
 *  - gazole seulement ; HVO/B100 exclu sauf réglage contraire (alors
 *    « à vérifier ») ; essence, GNV, GPL, électrique, hydrogène exclus.
 *  - immatriculation dans l'Union européenne.
 *  - un type estimé par l'IA et non confirmé : exclu (règle historique).
 *  - carte grise non jointe, PTAC inconnu : à vérifier.
 *  - véhicule loué : exclu si le remboursement est demandé par le loueur ;
 *    à vérifier si la règle vient seulement du réglage de l'organisation.
 */

import { PTAC_MIN_KG } from "@/lib/ticpe/export";
import { LIBELLES_CATEGORIE_COURTS, type CategorieTicpe } from "@/lib/ticpe/bareme";
import { activiteActive, MENTION_A_CONFIRMER, type ReglagesTicpe } from "@/lib/ticpe/reglages";
import type { VehicleType } from "@/lib/types/domain";

export type StatutEligibilite = "eligible" | "a_verifier" | "exclu";
export type GraviteRaison = "exclu" | "a_verifier" | "info";

export type CodeRaison =
  | "categorie_exclue"
  | "activite_inactive"
  | "vehicule_leger"
  | "ptac_insuffisant"
  | "ptac_inconnu"
  | "ptac_ia"
  | "energie_exclue"
  | "energie_hvo"
  | "energie_hybride"
  | "energie_inconnue"
  | "energie_ia"
  | "immatriculation_hors_ue"
  | "ia_non_confirmee"
  | "carte_grise_manquante"
  | "carte_grise_incoherente"
  | "location_loueur"
  | "location_a_confirmer"
  | "location_nous"
  | "taxi_lourd";

export interface Raison {
  code: CodeRaison;
  gravite: GraviteRaison;
  libelle: string;
}

type SourceSpec = { origin: string; confirmed: boolean } | undefined;

export interface VehiculeEligibilite {
  type: VehicleType;
  ptac_kg?: number | string | null;
  fuel_type?: string | null;
  spec_sources?: Record<string, SourceSpec> | null;
  ownership?: string | null;
  rental_start_date?: string | null;
  rental_end_date?: string | null;
  ticpe_categorie?: string | null;
  pays_immatriculation?: string | null;
  ticpe_location_demandeur?: string | null;
  flotte_entree_le?: string | null;
  flotte_sortie_le?: string | null;
  cg_genre?: string | null;
  cg_energie?: string | null;
  cg_confirmee_le?: string | null;
}

export interface ContexteEligibilite {
  reglages: ReglagesTicpe;
  /** Une carte grise est jointe au véhicule (vehicle_documents). */
  aCarteGrise: boolean;
}

export interface PeriodeEligibilite {
  /** AAAA-MM-JJ inclus ; null = sans borne. */
  debut: string | null;
  fin: string | null;
}

export interface ResultatEligibilite {
  statut: StatutEligibilite;
  raisons: Raison[];
  /** Catégorie retenue (null si exclu à la main). */
  categorie: CategorieTicpe | null;
  periode: PeriodeEligibilite;
}

/** Les 27 États membres de l'Union européenne (codes ISO 3166-1 alpha-2). */
export const PAYS_UE = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
] as const;

export type ClasseEnergie = "gazole" | "hvo_b100" | "hybride" | "exclu" | "inconnu";

const RE_HVO = /hvo|\bb ?100\b|\bxtl\b|biodiesel|\bb ?30\b|diester/i;
const RE_EXCLU = /essence|\bsp ?9[58]\b|\be ?85\b|super[ée]thanol|[ée]lectri|\bgnv\b|\bgnl\b|\bgpl\b|hydrog|bio ?gaz|bio ?gnv|\bgaz\b/i;
const RE_HYBRIDE = /hybride/i;
const RE_GAZOLE = /diesel|gazole|gasoil|gas-oil|\bgo\b/i;

/**
 * Classe une énergie à partir du texte libre de la fiche (fuel_type) ou
 * du code P.3 de la carte grise (GO gazole, ES essence, EL électrique,
 * GN GNV, GP/GL GPL, FE superéthanol, H2 hydrogène, GH/EH hybrides…).
 */
export function classerEnergie(fuelType: string | null | undefined, cgEnergie?: string | null): ClasseEnergie {
  const code = (cgEnergie ?? "").trim().toUpperCase();
  const texte = (fuelType ?? "").trim();
  if (texte && RE_HVO.test(texte)) return "hvo_b100";
  // La carte grise fait foi quand elle est lue.
  if (code === "GO") return "gazole";
  if (["GH", "GL", "GE"].includes(code)) return "hybride";
  if (code) return "exclu";
  if (!texte) return "inconnu";
  if (RE_HYBRIDE.test(texte)) return RE_GAZOLE.test(texte) ? "hybride" : "exclu";
  if (RE_EXCLU.test(texte)) return "exclu";
  if (RE_GAZOLE.test(texte)) return "gazole";
  return "inconnu";
}

function nombre(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const iaNonConfirme = (s: SourceSpec) => Boolean(s && s.origin === "ia" && !s.confirmed);

/** Plus tardive / plus précoce de deux dates optionnelles. */
const maxDate = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));
const minDate = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : (a ?? b));

export function estLoue(v: Pick<VehiculeEligibilite, "ownership">): boolean {
  return Boolean(v.ownership && v.ownership !== "propre");
}

/** Catégorie TICPE retenue pour un véhicule (null : exclu à la main). */
export function categorieVehicule(v: Pick<VehiculeEligibilite, "ticpe_categorie">, reglages: ReglagesTicpe): CategorieTicpe | null {
  if (v.ticpe_categorie === "exclu") return null;
  if (v.ticpe_categorie === "trm" || v.ticpe_categorie === "trv" || v.ticpe_categorie === "taxi") return v.ticpe_categorie;
  return reglages.categorie_par_defaut;
}

/** Genres J.1 de véhicules légers (incohérents avec un PL/SPL). */
const GENRES_LEGERS = ["VP", "CTTE", "DERIV-VP", "DERIV VP", "MTL", "MTT1", "MTT2", "CL", "QM"];

export function eligibiliteVehicule(v: VehiculeEligibilite, ctx: ContexteEligibilite): ResultatEligibilite {
  const { reglages } = ctx;
  const raisons: Raison[] = [];
  const ajouter = (code: CodeRaison, gravite: GraviteRaison, libelle: string) => raisons.push({ code, gravite, libelle });

  const categorie = categorieVehicule(v, reglages);
  const loue = estLoue(v);
  const periode: PeriodeEligibilite = {
    debut: maxDate(v.flotte_entree_le ?? null, loue ? (v.rental_start_date ?? null) : null),
    fin: minDate(v.flotte_sortie_le ?? null, loue ? (v.rental_end_date ?? null) : null),
  };

  if (categorie === null) {
    ajouter("categorie_exclue", "exclu", "Écarté de la TICPE sur la fiche du véhicule.");
  } else {
    if (!activiteActive(reglages, categorie)) {
      ajouter("activite_inactive", "exclu", `Activité « ${LIBELLES_CATEGORIE_COURTS[categorie]} » non cochée dans les réglages TICPE.`);
    }
    const lourd = v.type === "PL" || v.type === "SPL";
    if (categorie === "taxi") {
      if (lourd) ajouter("taxi_lourd", "a_verifier", "Taxi enregistré comme poids lourd : vérifiez le type ou la catégorie.");
    } else if (!lourd) {
      ajouter("vehicule_leger", "exclu", "Véhicule léger (VL/VUL) : jamais éligible, sauf taxi.");
    }

    if (iaNonConfirme(v.spec_sources?.type)) {
      ajouter("ia_non_confirmee", "exclu", "Type (PL/SPL) estimé par l'IA, pas encore confirmé sur la fiche.");
    }

    if (categorie === "trm" && lourd) {
      const ptac = nombre(v.ptac_kg);
      if (ptac === null) ajouter("ptac_inconnu", "a_verifier", "PTAC non renseigné (case F.2 de la carte grise) : 7,5 t minimum.");
      else if (ptac < PTAC_MIN_KG) ajouter("ptac_insuffisant", "exclu", `PTAC ${ptac.toLocaleString("fr-FR")} kg < 7,5 t.`);
      else if (iaNonConfirme(v.spec_sources?.ptac_kg)) ajouter("ptac_ia", "a_verifier", "PTAC estimé par l'IA, à confirmer avec la carte grise.");
    }

    const energie = classerEnergie(v.fuel_type, v.cg_energie);
    if (energie === "exclu") ajouter("energie_exclue", "exclu", `Énergie ${v.fuel_type || v.cg_energie} : seul le gazole ouvre droit au remboursement.`);
    else if (energie === "hvo_b100") {
      if (reglages.accepte_hvo_b100) ajouter("energie_hvo", "a_verifier", `HVO / B100 compté selon vos réglages (${MENTION_A_CONFIRMER}).`);
      else ajouter("energie_hvo", "exclu", `HVO / B100 : exclu par défaut (${MENTION_A_CONFIRMER}), modifiable dans les réglages.`);
    } else if (energie === "hybride") ajouter("energie_hybride", "a_verifier", "Motorisation hybride : vérifiez qu'elle consomme du gazole.");
    else if (energie === "inconnu") ajouter("energie_inconnue", "a_verifier", "Énergie non renseignée (case P.3 de la carte grise).");
    else if (iaNonConfirme(v.spec_sources?.fuel_type)) ajouter("energie_ia", "a_verifier", "Énergie estimée par l'IA, à confirmer.");

    const pays = (v.pays_immatriculation ?? "FR").toUpperCase();
    if (!(PAYS_UE as readonly string[]).includes(pays)) {
      ajouter("immatriculation_hors_ue", "exclu", `Immatriculé hors de l'Union européenne (${pays}).`);
    }

    if (!ctx.aCarteGrise) ajouter("carte_grise_manquante", "a_verifier", "Carte grise non jointe aux documents du véhicule.");
    const genre = (v.cg_genre ?? "").trim().toUpperCase();
    if (genre && lourd && GENRES_LEGERS.includes(genre)) {
      ajouter("carte_grise_incoherente", "a_verifier", `Genre ${genre} sur la carte grise (J.1) : incohérent avec un ${v.type}.`);
    }

    if (loue) {
      const demandeur = v.ticpe_location_demandeur === "nous" || v.ticpe_location_demandeur === "loueur" ? v.ticpe_location_demandeur : null;
      const effectif = demandeur ?? reglages.location_demandeur;
      if (effectif === "loueur") ajouter("location_loueur", "exclu", "Véhicule loué : le remboursement est demandé par le loueur.");
      else if (demandeur === "nous") ajouter("location_nous", "info", "Véhicule loué : le remboursement est demandé par nous (réglé sur la fiche).");
      else ajouter("location_a_confirmer", "a_verifier", `Véhicule loué : confirmez qui demande le remboursement (${MENTION_A_CONFIRMER}).`);
    }
  }

  const statut: StatutEligibilite = raisons.some((r) => r.gravite === "exclu") ? "exclu" : raisons.some((r) => r.gravite === "a_verifier") ? "a_verifier" : "eligible";
  return { statut, raisons, categorie, periode };
}

/** Le véhicule compte-t-il à cette date (AAAA-MM-JJ ou horodatage) ? */
export function compteLe(r: ResultatEligibilite, date: string): boolean {
  if (r.statut === "exclu") return false;
  return dansPeriodeEligibilite(r.periode, date);
}

export function dansPeriodeEligibilite(p: PeriodeEligibilite, date: string): boolean {
  const jour = date.slice(0, 10);
  return (!p.debut || jour >= p.debut) && (!p.fin || jour <= p.fin);
}

export const LIBELLES_STATUT_ELIGIBILITE: Record<StatutEligibilite, string> = {
  eligible: "Éligible",
  a_verifier: "À vérifier",
  exclu: "Exclu",
};

export const ICONES_STATUT_ELIGIBILITE: Record<StatutEligibilite, string> = {
  eligible: "✅",
  a_verifier: "⚠️",
  exclu: "❌",
};

/**
 * Véhicule « à régulariser » : à vérifier, ou exclu pour une raison
 * qu'une saisie corrige (type IA non confirmé). Un VL, un PTAC < 7,5 t
 * ou une énergie exclue ne se régularisent pas.
 */
export function aRegulariser(r: ResultatEligibilite): boolean {
  if (r.statut === "a_verifier") return true;
  return r.statut === "exclu" && r.raisons.filter((x) => x.gravite === "exclu").every((x) => x.code === "ia_non_confirmee");
}
