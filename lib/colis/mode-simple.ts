/**
 * Mode simple d'une tournée (delivery_runs.mode_simple) : pour qui n'utilise
 * GODAC que pour suivre ses adresses, deux actions par arrêt, « Livré » et
 * « Non livré » — ni lieu de dépôt, ni preuve, ni quantités de ramasse ou de
 * relais. Le mode complet reste le défaut. Modifiable tant que la tournée
 * n'est pas clôturée ; les arrêts déjà clôturés ne changent pas.
 */
import { libelleFait, refusPreuve, typeArret, type LieuLivraison } from "@/lib/colis/livraison";
import type { MotifEchec } from "@/lib/colis/cloture";

/** Tournée en mode simple ; absent (colonne non migrée) = mode complet. */
export const estModeSimple = (run: { mode_simple?: boolean | null } | null | undefined): boolean => run?.mode_simple === true;

/** Motif d'un « Non livré » en 1 clic, selon le type d'arrêt (précision facultative, modifiable ensuite). */
export function motifParDefaut(kind: string | null | undefined): MotifEchec {
  const t = typeArret(kind);
  return t === "ramasse" ? "rien_a_ramasser" : t === "point_relais" ? "ferme" : "absent";
}

/**
 * Preuve de remise exigée par l'API : aucune en mode simple (ni lieu, ni photo,
 * ni QR code, ni relais), les règles habituelles sinon.
 */
export function refusPreuveSelonMode(simple: boolean, p: { lieu: LieuLivraison; photo: boolean; code: string | null; relais: string | null }): string | null {
  return simple ? null : refusPreuve(p);
}

/** Le clic sur « Livré » clôt tout de suite (sans feuille de livraison ni saisie de quantité). */
export const livraisonDirecte = (simple: boolean): boolean => simple;

/** Mode d'une tournée dont la colonne n'a pas pu être lue : repli sur ce qui est mémorisé sur l'appareil. */
export function modeEffectif(run: { id: string; mode_simple?: boolean | null; mode_simple_persiste?: boolean }, locaux: ReadonlySet<string>): boolean {
  return run.mode_simple === true || (run.mode_simple_persiste === false && locaux.has(run.id));
}

/** Ensemble des tournées en mode simple mémorisé sur l'appareil (JSON du stockage local ; tolérant). */
export function lireModesLocaux(brut: string | null | undefined): Set<string> {
  try {
    const v = JSON.parse(brut ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-50) : []);
  } catch {
    return new Set();
  }
}

/** Mémoire locale après bascule (50 tournées au plus). */
export function ecrireModesLocaux(actuel: ReadonlySet<string>, runId: string, simple: boolean): string {
  const s = new Set(actuel);
  if (simple) s.add(runId);
  else s.delete(runId);
  return JSON.stringify([...s].slice(-50));
}

/**
 * Mode affiché : le dernier choix fait sur cet écran (effet immédiat, même
 * avant la réponse du serveur ou hors ligne), sinon celui de la tournée.
 */
export function modeAffiche(
  run: { id: string; mode_simple?: boolean | null; mode_simple_persiste?: boolean } | null,
  locaux: ReadonlySet<string>,
  choix: { id: string; simple: boolean } | null,
): boolean {
  if (!run) return false;
  return choix?.id === run.id ? choix.simple : modeEffectif(run, locaux);
}

/** Libellé du bouton de réussite : « Livré » en mode simple, « Livré » / « Ramassé » / « Déposé au relais » sinon. */
export function libelleLivre(simple: boolean, stop: { kind?: string | null }): string {
  return simple ? "Livré" : libelleFait(stop);
}
