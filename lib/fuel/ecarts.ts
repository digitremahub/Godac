/**
 * Écarts carburant d'un plein, et leur traitement par l'encadrement.
 *
 * Un « écart » est tout ce que GODAC signale déjà sur un plein :
 * - totaliseur : index avant ≠ index après du plein précédent sur la cuve
 *   (colonnes gap_flagged / totalizer_gap posées par le trigger
 *   compute_fuel_entry_derived, cf. lib/business/totalizer-gap.ts) ;
 * - litres incohérents avec le totaliseur avant/après (même tolérance de
 *   0,5 L que le trigger after_fuel_entry_trusted) ;
 * - prix unitaire éloigné du PMP de la cuve (> 15 %, idem trigger) ;
 * - montant du ticket lu par OCR ≠ litres × prix (lib/ocr/ticket-check.ts) ;
 * - consommation anormale du véhicule (alerte consumption_anomaly liée au
 *   plein, posée par after_fuel_entry_consumption_check).
 *
 * Le traitement est un journal (table fuel_gap_reviews, migration
 * 20261022000001) : chaque action est une ligne, la dernière donne le
 * statut. Pur — utilisé côté serveur (pages, API) comme côté navigateur.
 */

import { ticketAmountMismatch, ticketExtrasFromOcrRaw } from "@/lib/ocr/ticket-check";

/** Tolérances identiques aux triggers SQL (migration 121). */
export const TOLERANCE_TOTALISEUR_LITRES = 0.5;
export const SEUIL_ECART_PRIX_PMP = 0.15;

export type CodeEcart = "totaliseur" | "litres_totaliseur" | "prix_pmp" | "ticket_ocr" | "consommation";

export interface Ecart {
  code: CodeEcart;
  libelle: string;
  detail: string;
}

/** Colonnes de fuel_entries utiles à la détection (toutes réelles, cf. migrations 003/121). */
export interface PleinPourEcarts {
  liters: number | string | null;
  unit_price: number | string | null;
  totalizer_before?: number | string | null;
  totalizer_after?: number | string | null;
  totalizer_gap?: number | string | null;
  gap_flagged?: boolean | null;
  pmp_at_entry?: number | string | null;
  tank_id?: string | null;
  ocr_raw?: unknown;
}

/** Alerte liée au plein (alerts.related_table = 'fuel_entries'). */
export interface AlerteLiee {
  type: string;
  message?: string | null;
}

function nombre(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const litres = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} L`;
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const prixLitre = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 4 })} €/L`;

/** Liste des écarts détectés sur un plein (vide : aucun écart). */
export function ecartsDuPlein(plein: PleinPourEcarts, alertes: readonly AlerteLiee[] = []): Ecart[] {
  const ecarts: Ecart[] = [];
  const l = nombre(plein.liters);
  const prix = nombre(plein.unit_price);
  const avant = nombre(plein.totalizer_before);
  const apres = nombre(plein.totalizer_after);

  if (plein.gap_flagged) {
    const gap = nombre(plein.totalizer_gap);
    ecarts.push({
      code: "totaliseur",
      libelle: "Écart de totaliseur",
      detail:
        gap === null
          ? "L'index avant ne suit pas l'index après du plein précédent sur la cuve."
          : `${gap > 0 ? "+" : ""}${litres(gap)} entre l'index avant et l'index après du plein précédent sur la cuve.`,
    });
  }

  if (plein.tank_id && avant !== null && apres !== null && l !== null) {
    const distribue = Math.round((apres - avant) * 100) / 100;
    if (Math.abs(distribue - l) > TOLERANCE_TOTALISEUR_LITRES) {
      ecarts.push({
        code: "litres_totaliseur",
        libelle: "Litres incohérents avec le totaliseur",
        detail: `Le totaliseur indique ${litres(distribue)}, ${litres(l)} ont été déclarés.`,
      });
    }
  }

  const pmp = nombre(plein.pmp_at_entry);
  if (plein.tank_id && pmp !== null && pmp > 0 && prix !== null) {
    const ecartPrix = Math.abs(prix - pmp) / pmp;
    if (ecartPrix > SEUIL_ECART_PRIX_PMP) {
      ecarts.push({
        code: "prix_pmp",
        libelle: "Prix éloigné du PMP de la cuve",
        detail: `${prixLitre(prix)} saisi contre un PMP de ${prixLitre(pmp)} (${Math.round(ecartPrix * 100)} %).`,
      });
    }
  }

  const ticket = ticketExtrasFromOcrRaw(plein.ocr_raw);
  const mismatch = ticketAmountMismatch(l, prix, ticket.total_amount);
  if (mismatch) {
    ecarts.push({
      code: "ticket_ocr",
      libelle: "Montant différent du ticket",
      detail: `Litres × prix = ${euros(mismatch.computed)}, ticket lu = ${euros(mismatch.ticket)} (écart ${euros(Math.abs(mismatch.gap))}).`,
    });
  }

  const conso = alertes.find((a) => a.type === "consumption_anomaly");
  if (conso) {
    ecarts.push({
      code: "consommation",
      libelle: "Consommation anormale",
      detail: conso.message?.trim() || "Consommation du véhicule en hausse par rapport à son habitude.",
    });
  }

  return ecarts;
}

// ── Traitement ────────────────────────────────────────────────────

/** Actions enregistrées dans fuel_gap_reviews.action. */
export const ACTIONS_ECART = ["traite", "explication_demandee", "reponse_chauffeur"] as const;
export type ActionEcart = (typeof ACTIONS_ECART)[number];

export const LIBELLES_ACTION_ECART: Record<ActionEcart, string> = {
  traite: "Justifié / classé",
  explication_demandee: "Explication demandée au chauffeur",
  reponse_chauffeur: "Réponse du chauffeur",
};

export type StatutEcart = "aucun" | "ouvert" | "explication_demandee" | "reponse_recue" | "traite";

export const LIBELLES_STATUT_ECART: Record<StatutEcart, string> = {
  aucun: "Aucun écart",
  ouvert: "Écart à traiter",
  explication_demandee: "Explication demandée",
  reponse_recue: "Réponse du chauffeur reçue",
  traite: "Écart traité",
};

export interface TraitementEcart {
  action: string;
  created_at: string;
}

/**
 * Statut de l'écart d'un plein : la dernière action du journal décide.
 * Sans écart détecté ni action, « aucun » ; un plein corrigé après coup
 * (écart disparu) garde le statut de son traitement.
 */
export function statutEcart(nbEcarts: number, traitements: readonly TraitementEcart[]): StatutEcart {
  const dernier = [...traitements].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
  if (!dernier) return nbEcarts > 0 ? "ouvert" : "aucun";
  if (dernier.action === "traite") return "traite";
  if (dernier.action === "explication_demandee") return "explication_demandee";
  if (dernier.action === "reponse_chauffeur") return "reponse_recue";
  return nbEcarts > 0 ? "ouvert" : "aucun";
}

export interface DroitsEcart {
  /** Justifier / classer, demander une explication. */
  traiter: boolean;
  /** Répondre à une demande d'explication (le chauffeur du plein). */
  repondre: boolean;
}

/**
 * Qui peut agir sur l'écart d'un plein. Encadrement seulement (manager,
 * direction) pour le traitement ; un manager qui conduit ne traite pas
 * l'écart de son propre plein (la direction, si). Le chauffeur du plein
 * peut seulement répondre à une demande d'explication en cours.
 * La RLS de fuel_gap_reviews applique la même règle en base.
 */
export function droitsEcart(params: {
  role: string;
  userId: string;
  driverId: string | null | undefined;
  statut: StatutEcart;
}): DroitsEcart {
  const { role, userId, driverId, statut } = params;
  const sonPlein = Boolean(driverId) && driverId === userId;
  const encadrement = role === "direction" || (role === "manager" && !sonPlein);
  return {
    traiter: encadrement && statut !== "aucun" && statut !== "traite",
    repondre: sonPlein && statut === "explication_demandee",
  };
}

/** Action autorisée pour ces droits ? (contrôle serveur avant écriture). */
export function actionAutorisee(action: ActionEcart, droits: DroitsEcart): boolean {
  return action === "reponse_chauffeur" ? droits.repondre : droits.traiter;
}

/** Commentaire obligatoire : au moins 3 caractères utiles, 2 000 au plus. */
export const COMMENTAIRE_MIN = 3;
export const COMMENTAIRE_MAX = 2000;

export function commentaireValide(commentaire: string | null | undefined): boolean {
  const c = (commentaire ?? "").trim();
  return c.length >= COMMENTAIRE_MIN && c.length <= COMMENTAIRE_MAX;
}

/**
 * Erreur Supabase/PostgREST d'une table absente (migration pas encore
 * appliquée) : 42P01 côté Postgres, PGRST205 côté cache de schéma.
 */
export function tableAbsente(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}
