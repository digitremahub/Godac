/**
 * Glossaire « tournée » (lot 3 de l'audit d'ergonomie) : un mot, un sens,
 * partout à l'écran (menu, titres, guides, alertes). Seuls les textes
 * affichés suivent ce glossaire : les tables et colonnes en base gardent
 * leurs noms (planning_entries, delivery_runs, tour_routes,
 * planning_tour_templates).
 *
 * Affiché dans l'aide (page Guide) et vérifié par
 * lib/acces/__tests__/glossaire.test.ts : les anciens libellés (`aEviter`)
 * ne doivent plus revenir dans le catalogue, le menu, la barre mobile ni
 * les guides.
 */

export interface TermeGlossaire {
  terme: string;
  definition: string;
  /** Exemple d'emploi à l'écran. */
  exemple: string;
  /** Anciens libellés, interdits à l'écran (comparaison sans casse). */
  aEviter: readonly string[];
}

export const GLOSSAIRE_TOURNEE: readonly TermeGlossaire[] = [
  {
    terme: "Tournée",
    definition: "L'affectation du planning : un numéro de tournée (T106), un chauffeur, un véhicule, un jour.",
    exemple: "« Tournée n°T106 en cours »",
    aEviter: ["fiche tournée"],
  },
  {
    terme: "Départ / Retour",
    definition: "La prise et la fin de poste avec le véhicule : kilométrage, état du véhicule, photos.",
    exemple: "« Faire mon départ », « Faire mon retour »",
    aEviter: ["Démarrer une tournée", "Terminer une tournée", "Terminer ma tournée", "J'entre pour un collègue"],
  },
  {
    terme: "Tournée colis",
    definition: "La liste des colis du jour à livrer ou ramasser, arrêt par arrêt. Chez le conducteur : « Ma tournée colis » (préparer, démarrer, livrer, clôturer).",
    exemple: "« Ma tournée colis », « Clôturer la tournée colis »",
    aEviter: ["fiche chauffeur", "fiche colis", "fiches colis", "Application chauffeur", "GODAC Livreur", "Mode chauffeur plein écran"],
  },
  {
    terme: "Modèle de tournée",
    definition: "La tournée-modèle : son numéro, ses villages dans l'ordre de passage, ses ramasses et points relais.",
    exemple: "« Modèles de tournées & villages »",
    aEviter: ["Tournées & villages", "Tournées et villages", "Tournées villages", "tournée-modèle", "tournées-modèles"],
  },
  {
    terme: "Affectation récurrente",
    definition: "Une affectation du planning qui se répète chaque semaine (même modèle de tournée, mêmes jours, même heure) et sert à générer la semaine.",
    exemple: "« + Nouvelle affectation récurrente »",
    aEviter: ["Nouveau modèle de tournée"],
  },
  {
    terme: "Arrêt",
    definition: "Une adresse de la tournée colis : livraison, ramasse ou point relais.",
    exemple: "« Arrêt 3 / 42 »",
    aEviter: ["Stops de ramasse"],
  },
];

/** Tous les libellés interdits (comparaison sans casse). */
export const LIBELLES_A_EVITER: readonly string[] = GLOSSAIRE_TOURNEE.flatMap((t) => t.aEviter);

/** Termes du glossaire qui contiennent un ancien libellé (« Modèles de tournées & villages »). */
const TERMES_ENGLOBANTS = ["modèles de tournées & villages", "modèles de tournées et villages"];

/** Premier ancien libellé trouvé dans un texte, sinon null. */
export function ancienLibelle(texte: string): string | null {
  let t = texte.toLocaleLowerCase("fr-FR");
  for (const g of TERMES_ENGLOBANTS) t = t.split(g).join(" ");
  return LIBELLES_A_EVITER.find((a) => t.includes(a.toLocaleLowerCase("fr-FR"))) ?? null;
}
