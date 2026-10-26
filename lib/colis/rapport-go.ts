/**
 * Rapports de tournée (Exploitation › Historique › Rapports) : la lecture
 * automatique des photos de la feuille de tournée laisse souvent des champs
 * vides (heure de départ, arrêts, ramasses…) alors que la tournée a bien été
 * faite dans GO. Ces champs sont complétés, à l'affichage seulement, par ce
 * que GO a enregistré (tournée colis liée au planning) ; la valeur lue sur la
 * photo ou corrigée par la direction reste prioritaire et rien n'est écrit en
 * base.
 *
 * Logique pure, testée dans lib/colis/__tests__/rapport-go.test.ts.
 */
import { estRamasse } from "@/lib/colis/livraison";
import { jourParis } from "@/lib/colis/historique";

export interface ArretRapport {
  status: string;
  kind?: string | null;
  parcel_count: number;
  packages_picked_up?: number | null;
  done_at: string | null;
}

export interface TourneeRapport {
  id: string;
  planning_entry_id: string | null;
  driver_id: string;
  run_date: string;
  started_at: string | null;
}

export interface DonneesGo {
  /** Heure de départ (HH:MM, Paris) : démarrage de la tournée dans GO. */
  depart: string | null;
  /** Heure de retour (HH:MM, Paris) : dernier arrêt traité. */
  retour: string | null;
  /** Arrêts hors ramasses. */
  arrets: number;
  /** Arrêts livrés hors ramasses. */
  livres: number;
  /** Colis à livrer (hors ramasses). */
  colis: number;
  /** Arrêts de ramasse. */
  ramasses: number;
  /** Colis ramassés (ramasses faites). */
  colisRamasses: number;
  /** Colis non remis (arrêts en échec), ramenés au dépôt. */
  ramenes: number;
}

const heureParis = (iso: string | null): string | null =>
  iso ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : null;

/** Données GO d'une tournée : arrêts et heures ; null sans arrêt. */
export function donneesGo(run: Pick<TourneeRapport, "started_at">, arrets: ArretRapport[]): DonneesGo | null {
  if (!arrets.length) return null;
  const livraisons = arrets.filter((s) => !estRamasse(s));
  const ramasses = arrets.filter(estRamasse);
  const faits = arrets.filter((s) => s.status !== "pending");
  const dernier = faits.reduce<string | null>((m, s) => (s.done_at && (!m || s.done_at > m) ? s.done_at : m), null);
  const toutFait = faits.length === arrets.length;
  return {
    depart: heureParis(run.started_at),
    retour: toutFait ? heureParis(dernier) : null,
    arrets: livraisons.length,
    livres: livraisons.filter((s) => s.status === "delivered").length,
    colis: livraisons.reduce((n, s) => n + s.parcel_count, 0),
    ramasses: ramasses.length,
    colisRamasses: ramasses.filter((s) => s.status === "delivered").reduce((n, s) => n + (s.packages_picked_up ?? s.parcel_count), 0),
    ramenes: livraisons.filter((s) => s.status === "failed").reduce((n, s) => n + s.parcel_count, 0),
  };
}

/**
 * Tournée colis d'une ligne de planning : celle qui lui est liée, sinon la
 * seule tournée du même chauffeur le même jour (heure de Paris).
 */
export function tourneeDeLigne(ligne: { id: string; driver_id?: string | null; start_at: string }, runs: TourneeRapport[]): TourneeRapport | null {
  const liee = runs.find((r) => r.planning_entry_id === ligne.id);
  if (liee) return liee;
  if (!ligne.driver_id) return null;
  const jour = jourParis(ligne.start_at);
  const memeJour = runs.filter((r) => r.planning_entry_id === null && r.driver_id === ligne.driver_id && r.run_date === jour);
  return memeJour.length === 1 ? memeJour[0]! : null;
}
