/**
 * Séquence de l'animation GODAC (accueil, pied de page) : les lettres
 * s'assemblent en profondeur, puis le trait lumineux de la tournée les relie
 * une à une, un point marquant chaque arrêt. Aucun mot : la phrase officielle
 * reste en texte masqué visuellement. Logique pure : les délais calculés ici
 * sont posés en variables CSS par le composant.
 */

export interface ParametresSequence {
  /** Écart entre l'arrivée de deux lettres. */
  ecartLettreMs: number;
  /** Durée de l'assemblage d'une lettre. */
  dureeLettreMs: number;
  /** Pause entre la dernière lettre assemblée et le premier point. */
  pauseAvantTraceMs: number;
  /** Durée d'apparition d'un point. */
  dureeNoeudMs: number;
  /** Durée du trait entre deux lettres. */
  dureeTraitMs: number;
}

export const SEQUENCE_PAR_DEFAUT: ParametresSequence = {
  ecartLettreMs: 130,
  dureeLettreMs: 900,
  pauseAvantTraceMs: 150,
  dureeNoeudMs: 400,
  dureeTraitMs: 420,
};

export interface EtapeSequence {
  indice: number;
  delaiLettreMs: number;
  /** Point sous la lettre. */
  delaiNoeudMs: number;
  /** Trait vers la lettre suivante ; absent pour la dernière lettre. */
  delaiTraitMs: number | null;
}

export interface Sequence {
  etapes: EtapeSequence[];
  dureeTotaleMs: number;
}

/**
 * Délais de chaque étape pour `nombre` lettres. Le trait part de son point à
 * mi-apparition et arrive quand le point suivant apparaît.
 */
export function sequenceGodac(nombre: number, p: ParametresSequence = SEQUENCE_PAR_DEFAUT): Sequence {
  const n = Math.max(0, Math.floor(nombre));
  if (n === 0) return { etapes: [], dureeTotaleMs: 0 };
  const finLettres = (n - 1) * p.ecartLettreMs + p.dureeLettreMs;
  const debutTrace = finLettres + p.pauseAvantTraceMs;
  const demi = Math.round(p.dureeNoeudMs / 2);
  const pas = demi + p.dureeTraitMs;
  const etapes = Array.from({ length: n }, (_, i): EtapeSequence => {
    const delaiNoeudMs = debutTrace + i * pas;
    return {
      indice: i,
      delaiLettreMs: i * p.ecartLettreMs,
      delaiNoeudMs,
      delaiTraitMs: i < n - 1 ? delaiNoeudMs + demi : null,
    };
  });
  const dernier = etapes[n - 1]!;
  return { etapes, dureeTotaleMs: dernier.delaiNoeudMs + p.dureeNoeudMs };
}

/** Ce que montre l'animation à un instant donné. */
export type EtatGodac = "statique" | "attente" | "joue";

/**
 * - `statique` : lettres et tracé complets, rien ne bouge (mouvement réduit,
 *   appareil modeste, JS absent ou pas encore monté) ;
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
