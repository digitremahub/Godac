/**
 * Fermer / rouvrir une tournée NON AFFECTÉE un ou plusieurs jours (logique
 * pure, testée dans __tests__/fermeture-tournee.test.ts ; route
 * app/api/planning/fermetures).
 *
 * Modèle : une tournée sans chauffeur fermée est une ligne planning_entries
 * sans driver_id avec tour_open = false (lib/planning/ouverture.ts ›
 * estFermeeNonAffectee). Pas de nouvelle table : la grille, la couverture,
 * le cron et « À traiter » lisent déjà planning_entries ; la RLS aussi.
 * Rouvrir supprime cette ligne vide (la case redevient « sans chauffeur »,
 * comme avant la fermeture).
 */
import { jourDe, type AffectationPlanning } from "@/lib/planning/semaine";
import { estOuverte } from "@/lib/planning/ouverture";

type Existante = Pick<AffectationPlanning, "id" | "driver_id" | "start_at" | "status" | "tour_open">;

export type DecisionFermeture =
  /** Aucune ligne ce jour-là : en créer une, fermée et sans chauffeur. */
  | { type: "creer"; date: string; startAt: string }
  /** Ligne(s) sans chauffeur encore ouverte(s) (« à remplacer ») : les fermer. */
  | { type: "fermer"; date: string; entreeIds: string[] }
  /** Déjà fermée sans chauffeur : rien à faire. */
  | { type: "deja"; date: string }
  /** Un chauffeur est placé (ou la tournée est démarrée) : refus, on retire d'abord le chauffeur. */
  | { type: "affectee"; date: string; raison: "chauffeur" | "demarree" };

/** Lignes d'un jour pour une tournée (hors annulées et présences). */
function duJour(existantes: readonly Existante[], date: string): Existante[] {
  return existantes.filter((e) => e.status !== "cancelled" && e.status !== "presence" && jourDe(e.start_at) === date);
}

/**
 * Pour chaque jour demandé : créer la fermeture, fermer la ligne « à
 * remplacer », constater qu'elle l'est déjà, ou refuser parce qu'un chauffeur
 * y est placé. `existantes` : les lignes de CETTE tournée (service + numéro).
 */
export function decisionsFermeture(p: {
  dates: readonly string[];
  heure: string;
  existantes: readonly Existante[];
  versUtc: (date: string, heure: string) => string;
}): DecisionFermeture[] {
  return [...new Set(p.dates)].sort().map((date): DecisionFermeture => {
    const lignes = duJour(p.existantes, date);
    if (lignes.some((e) => e.driver_id)) return { type: "affectee", date, raison: "chauffeur" };
    if (lignes.some((e) => e.status !== "planned")) return { type: "affectee", date, raison: "demarree" };
    const ouvertes = lignes.filter(estOuverte);
    if (ouvertes.length) return { type: "fermer", date, entreeIds: ouvertes.map((e) => e.id) };
    if (lignes.length) return { type: "deja", date };
    return { type: "creer", date, startAt: p.versUtc(date, p.heure) };
  });
}

export type DecisionReouverture =
  | { type: "rouvrir"; date: string; entreeIds: string[] }
  /** Rien de fermé sans chauffeur ce jour-là (ouverte, ou fermée mais affectée : bouton « Rouvrir » de l'affectation). */
  | { type: "rien"; date: string; raison: "ouverte" | "affectee" };

/** Pour chaque jour : les fermetures sans chauffeur à lever. */
export function decisionsReouverture(p: { dates: readonly string[]; existantes: readonly Existante[] }): DecisionReouverture[] {
  return [...new Set(p.dates)].sort().map((date): DecisionReouverture => {
    const lignes = duJour(p.existantes, date);
    const fermees = lignes.filter((e) => !estOuverte(e) && !e.driver_id && e.status === "planned");
    if (fermees.length) return { type: "rouvrir", date, entreeIds: fermees.map((e) => e.id) };
    return { type: "rien", date, raison: lignes.some((e) => !estOuverte(e)) ? "affectee" : "ouverte" };
  });
}

export interface BilanFermeture {
  fermees: number;
  deja: number;
  /** Jours refusés parce qu'un chauffeur y est placé (ou tournée démarrée). */
  refusees: string[];
}

const jours = (n: number) => `${n} jour${n > 1 ? "s" : ""}`;

/** « 3 jours fermés, 1 déjà fermé ; vendredi non fermé (chauffeur placé : retirez-le d'abord) » */
export function texteFermeture(b: BilanFermeture, libelleJour: (d: string) => string): string {
  const parts: string[] = [];
  if (b.fermees) parts.push(`${jours(b.fermees)} fermé${b.fermees > 1 ? "s" : ""}`);
  if (b.deja) parts.push(`${b.deja} déjà fermé${b.deja > 1 ? "s" : ""}`);
  if (b.refusees.length) parts.push(`${b.refusees.map(libelleJour).join(", ")} non fermé${b.refusees.length > 1 ? "s" : ""} (chauffeur placé ou tournée démarrée : retirez d'abord le chauffeur)`);
  return parts.join(", ") || "Rien à fermer";
}

/** « 2 jours rouverts » */
export function texteReouverture(rouvertes: number): string {
  return rouvertes > 0 ? `${jours(rouvertes)} rouvert${rouvertes > 1 ? "s" : ""}` : "Rien à rouvrir";
}
