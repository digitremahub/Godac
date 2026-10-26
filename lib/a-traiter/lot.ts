/**
 * Actions groupées de « À traiter aujourd'hui » : logique pure (limites,
 * actions possibles par type, corps de la requête individuelle, résultat
 * par élément). Le traitement lui-même est fait par les routes
 * individuelles existantes (lib/a-traiter/lot-serveur.ts) : mêmes
 * contrôles serveur, mêmes notifications, même journal.
 */

import { typeVisiblePour, type TypeATraiter } from "@/lib/a-traiter/logique";
import { ecranOuvrable, type ContexteAccueil } from "@/lib/acces/tuiles-accueil";

/** Taille maximale d'un lot. */
export const LOT_MAX = 50;

export const ACTIONS_LOT = ["valider", "refuser"] as const;
export type ActionLot = (typeof ACTIONS_LOT)[number];

/** Types pour lesquels le traitement individuel existe déjà (donc le lot). */
export const TYPES_LOT = ["ecart_carburant", "amende", "entretien", "conge", "arret"] as const;
export type TypeLot = (typeof TYPES_LOT)[number];

export function estTypeLot(type: string): type is TypeLot {
  return (TYPES_LOT as readonly string[]).includes(type);
}

export const LIBELLE_ACTION: Record<ActionLot, { verbe: string; participe: string }> = {
  valider: { verbe: "Valider", participe: "validé" },
  refuser: { verbe: "Refuser", participe: "refusé" },
};

/**
 * Ce que « Valider » et « Refuser » veulent dire pour chaque type, d'après
 * l'écran de traitement individuel :
 *  - écart carburant : « justifier / classer » (commentaire obligatoire), pas de refus ;
 *  - amende : confirmer le responsable suggéré, pas de refus en lot (classer une amende se décide une à une) ;
 *  - entretien : prendre en charge (planifiée → en cours) / annuler ;
 *  - congé : approuver / refuser ;
 *  - arrêt de travail : valider / refuser (motif obligatoire).
 */
export const SENS_ACTION: Record<TypeLot, { valider: string | null; refuser: string | null }> = {
  ecart_carburant: { valider: "justifié / classé", refuser: null },
  amende: { valider: "responsable suggéré confirmé", refuser: null },
  entretien: { valider: "pris en charge", refuser: "annulé" },
  conge: { valider: "approuvé", refuser: "refusé" },
  arret: { valider: "validé", refuser: "refusé" },
};

/** Écran du catalogue qui traite chaque type (même écran que la source de « À traiter »). */
export const ECRAN_PAR_TYPE_LOT: Record<TypeLot, string> = {
  ecart_carburant: "carburant.pleins",
  amende: "flotte.amendes",
  entretien: "flotte.entretien",
  conge: "equipe.conges",
  arret: "equipe.arrets",
};

/**
 * Le rôle peut-il traiter ce type en groupe ? Même périmètre que la liste
 * « À traiter » : un manager ne traite en lot que carburant, entretien et
 * congés (jamais amendes ni arrêts de travail, qui restent à l'exploitation
 * et à la direction), et l'écran du type doit s'ouvrir pour lui (rôle,
 * modules). La route individuelle reste l'autorité (rôle, hiérarchie, RLS).
 */
export function typeLotAutorise(type: TypeLot, ctx: ContexteAccueil): boolean {
  return typeVisiblePour(type, ctx.role) && ecranOuvrable(ECRAN_PAR_TYPE_LOT[type], ctx);
}

export const MOTIF_TYPE_NON_AUTORISE = "Ce type d'élément n'est pas dans votre périmètre.";

export function actionPossible(type: TypeATraiter | string, action: ActionLot): boolean {
  return estTypeLot(type) && SENS_ACTION[type][action] !== null;
}

export const COMMENTAIRE_LOT_MAX = 2000;
const COMMENTAIRE_LOT_MIN = 3;

/** Un commentaire commun est-il obligatoire pour cette action sur ces types ? (même exigence que l'écran individuel) */
export function commentaireRequis(action: ActionLot, types: readonly (TypeATraiter | string)[]): boolean {
  return types.some((t) => (t === "ecart_carburant" && action === "valider") || (t === "arret" && action === "refuser"));
}

export function commentaireValide(commentaire: string | null | undefined): boolean {
  const c = (commentaire ?? "").trim();
  return c.length >= COMMENTAIRE_LOT_MIN && c.length <= COMMENTAIRE_LOT_MAX;
}

export interface ElementLot {
  type: TypeLot;
  id: string;
}

export const cleLot = (e: ElementLot) => `${e.type}:${e.id}`;

/** Retire les doublons (même type et même identifiant), en gardant l'ordre. */
export function dedoublonner<T extends ElementLot>(elements: readonly T[]): T[] {
  const vus = new Set<string>();
  return elements.filter((e) => {
    const c = cleLot(e);
    if (vus.has(c)) return false;
    vus.add(c);
    return true;
  });
}

/** Requête individuelle équivalente à l'action groupée, ou null si le type ne la permet pas. */
export interface RequeteIndividuelle {
  methode: "PATCH" | "POST";
  corps: Record<string, unknown>;
}

export function requeteIndividuelle(type: TypeLot, action: ActionLot, commentaire: string | null): RequeteIndividuelle | null {
  if (!actionPossible(type, action)) return null;
  const c = (commentaire ?? "").trim();
  switch (type) {
    case "ecart_carburant":
      return { methode: "POST", corps: { action: "traite", commentaire: c } };
    case "amende":
      return { methode: "PATCH", corps: { action: "valider" } };
    case "entretien":
      return { methode: "PATCH", corps: { status: action === "valider" ? "in_progress" : "cancelled" } };
    case "conge":
      return { methode: "PATCH", corps: { status: action === "valider" ? "approved" : "rejected" } };
    case "arret":
      return { methode: "PATCH", corps: action === "valider" ? { action: "valider" } : { action: "refuser", motif: c } };
  }
}

// ── Résultat ────────────────────────────────────────────────────────

export interface ResultatElement {
  cle: string;
  type: TypeLot;
  id: string;
  ok: boolean;
  /** Motif du refus, en français. */
  motif?: string;
}

export interface ResumeLot {
  total: number;
  reussis: number;
  refuses: number;
}

export function resumer(resultats: readonly Pick<ResultatElement, "ok">[]): ResumeLot {
  const reussis = resultats.filter((r) => r.ok).length;
  return { total: resultats.length, reussis, refuses: resultats.length - reussis };
}

/** Texte de synthèse, au singulier comme au pluriel. */
export function messageResume(r: ResumeLot): string {
  if (r.total === 0) return "Aucun élément traité.";
  if (r.refuses === 0) return r.total === 1 ? "1 élément traité." : `${r.total} éléments traités.`;
  if (r.reussis === 0) return r.total === 1 ? "1 élément refusé, rien n'a été modifié." : `Les ${r.total} éléments ont été refusés, rien n'a été modifié.`;
  return `${r.reussis} traité${r.reussis > 1 ? "s" : ""}, ${r.refuses} refusé${r.refuses > 1 ? "s" : ""} (voir le détail).`;
}

/** Motif lisible à partir de la réponse d'une route individuelle (chaîne, ou erreur de validation zod). */
export function motifDepuisReponse(statut: number, corps: unknown): string {
  const erreur = corps && typeof corps === "object" ? (corps as { error?: unknown }).error : null;
  if (typeof erreur === "string" && erreur.trim()) return erreur.trim().slice(0, 300);
  if (statut === 401) return "Session expirée, reconnectez-vous.";
  if (statut === 403) return "Action non autorisée.";
  if (statut === 404) return "Élément introuvable ou hors de votre périmètre.";
  if (statut === 400 || statut === 422) return "Données invalides pour cet élément.";
  if (statut === 503) return "Fonction indisponible : mise à jour de la base en attente.";
  return "Le traitement a échoué.";
}

/** Résultat d'un élément d'après le statut HTTP de la route individuelle. */
export function resultatDepuisReponse(el: ElementLot, statut: number, corps: unknown): ResultatElement {
  const base = { cle: cleLot(el), type: el.type, id: el.id };
  if (statut >= 200 && statut < 300) return { ...base, ok: true };
  return { ...base, ok: false, motif: motifDepuisReponse(statut, corps) };
}

export function resultatRefuse(el: ElementLot, motif: string): ResultatElement {
  return { cle: cleLot(el), type: el.type, id: el.id, ok: false, motif };
}

/** Répartition par type, pour le journal d'audit (aucune donnée personnelle). */
export function repartitionParType(elements: readonly Pick<ElementLot, "type">[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const e of elements) r[e.type] = (r[e.type] ?? 0) + 1;
  return r;
}

/**
 * Litrage cumulé et véhicules concernés par les écarts carburant d'une
 * sélection : affiché avant la confirmation d'une validation en lot (une
 * seule justification commune pour tous, axe TICPE).
 */
export function resumeLitrage(elements: readonly { type: string; litres?: number | null; vehicule?: string | null }[]): { ecarts: number; litres: number; vehicules: string[] } {
  const ecarts = elements.filter((e) => e.type === "ecart_carburant");
  const litres = Math.round(ecarts.reduce((n, e) => n + (e.litres ?? 0), 0) * 10) / 10;
  const vehicules = [...new Set(ecarts.map((e) => e.vehicule).filter((v): v is string => Boolean(v)))].sort();
  return { ecarts: ecarts.length, litres, vehicules };
}

/** Phrase du récapitulatif (vide sans écart carburant). */
export function phraseLitrage(r: { ecarts: number; litres: number; vehicules: string[] }): string {
  if (r.ecarts === 0) return "";
  const l = r.litres.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `Écarts carburant : ${l} L cumulés sur ${r.vehicules.length} véhicule${r.vehicules.length > 1 ? "s" : ""}${r.vehicules.length ? ` (${r.vehicules.slice(0, 8).join(", ")}${r.vehicules.length > 8 ? "…" : ""})` : ""}, une seule justification pour tous.`;
}
