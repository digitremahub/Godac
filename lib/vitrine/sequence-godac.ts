/**
 * Séquence de l'animation GODAC (accueil, pied de page) : les lettres
 * s'assemblent en profondeur, puis chaque mot se déploie à son tour pendant
 * que le trait de la tournée les relie. Logique pure : les délais calculés ici
 * sont posés en variables CSS par le composant.
 */

export interface ParametresSequence {
  /** Écart entre l'arrivée de deux lettres. */
  ecartLettreMs: number;
  /** Durée de l'assemblage d'une lettre. */
  dureeLettreMs: number;
  /** Pause entre la dernière lettre assemblée et le premier mot. */
  pauseAvantMotsMs: number;
  /** Écart entre l'apparition de deux mots. */
  ecartMotMs: number;
  /** Durée du dépliage d'un mot. */
  dureeMotMs: number;
  /** Durée du trait entre deux lettres. */
  dureeTraitMs: number;
}

export const SEQUENCE_PAR_DEFAUT: ParametresSequence = {
  ecartLettreMs: 130,
  dureeLettreMs: 900,
  pauseAvantMotsMs: 200,
  ecartMotMs: 520,
  dureeMotMs: 600,
  dureeTraitMs: 520,
};

export interface EtapeSequence {
  indice: number;
  delaiLettreMs: number;
  delaiMotMs: number;
  /** Trait vers la lettre suivante ; absent pour la dernière lettre. */
  delaiTraitMs: number | null;
}

export interface Sequence {
  etapes: EtapeSequence[];
  dureeTotaleMs: number;
}

/**
 * Délais de chaque étape pour `nombre` lettres. Le trait vers la lettre
 * suivante part avec le mot courant et arrive quand le mot suivant se déplie.
 */
export function sequenceGodac(nombre: number, p: ParametresSequence = SEQUENCE_PAR_DEFAUT): Sequence {
  const n = Math.max(0, Math.floor(nombre));
  if (n === 0) return { etapes: [], dureeTotaleMs: 0 };
  const finLettres = (n - 1) * p.ecartLettreMs + p.dureeLettreMs;
  const debutMots = finLettres + p.pauseAvantMotsMs;
  const etapes = Array.from({ length: n }, (_, i): EtapeSequence => {
    const delaiMotMs = debutMots + i * p.ecartMotMs;
    return {
      indice: i,
      delaiLettreMs: i * p.ecartLettreMs,
      delaiMotMs,
      delaiTraitMs: i < n - 1 ? delaiMotMs + Math.round(p.dureeMotMs / 2) : null,
    };
  });
  const dernier = etapes[n - 1]!;
  const dureeTotaleMs = Math.max(dernier.delaiMotMs + p.dureeMotMs, ...etapes.map((e) => (e.delaiTraitMs ?? 0) + p.dureeTraitMs));
  return { etapes, dureeTotaleMs };
}

/** Ce que montre l'animation à un instant donné. */
export type EtatGodac = "statique" | "attente" | "joue";

/**
 * - `statique` : phrase complète, rien ne bouge (mouvement réduit, appareil
 *   modeste, JS absent ou pas encore monté) ;
 * - `attente` : l'animation est permise mais la scène n'est pas encore à
 *   l'écran, les éléments sont prêts à entrer ;
 * - `joue` : la séquence a démarré (elle se termine d'elle-même).
 */
export function etatGodac(autorise: boolean, dejaVisible: boolean): EtatGodac {
  if (!autorise) return "statique";
  return dejaVisible ? "joue" : "attente";
}

/**
 * Un survol ou un toucher relance la séquence seulement si elle est
 * terminée, pour ne pas la hacher quand la souris passe en cours de route.
 */
export function peutRejouer(autorise: boolean, joueDepuisMs: number | null, dureeTotaleMs: number): boolean {
  if (!autorise || joueDepuisMs === null) return false;
  return joueDepuisMs >= dureeTotaleMs;
}
