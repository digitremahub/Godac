import type { NaturePrime, Prime } from "@/lib/paie/types";

/**
 * Primes reprises d'un mois sur l'autre. Jusqu'ici, toute prime du dernier
 * bulletin validé était recopiée, ponctuelle ou non : risque de double
 * paiement si la personne qui prépare la paie ne la retirait pas. Chaque prime
 * porte désormais un marqueur « récurrente / ponctuelle », modifiable dans
 * l'éditeur du bulletin. Fichier pur, testé dans lib/paie/__tests__/primes.test.ts.
 * Aucune formule de paie n'est touchée : le marqueur n'entre pas dans le calcul.
 */

export const LIBELLE_NATURE_PRIME: Record<NaturePrime, string> = {
  recurrente: "Récurrente (reprise chaque mois)",
  ponctuelle: "Ponctuelle (ce mois seulement)",
};

/**
 * Primes du bulletin précédent à reprendre dans le suivant :
 *  - « ponctuelle » : jamais reprise ;
 *  - « récurrente » : reprise, marqueur conservé ;
 *  - sans marqueur (bulletin d'avant, jamais précisée) : reprise, signalée
 *    « recopiée » pour être confirmée ou retirée.
 */
export function reprendrePrimes(precedentes: readonly Prime[] | null | undefined): Prime[] {
  return (precedentes ?? [])
    .filter((p) => p.montant && p.nature !== "ponctuelle")
    .map((p) => (p.nature === "recurrente" ? { ...p, recopiee: false } : { ...p, recopiee: true }));
}

/** Prime recopiée dont personne n'a précisé la nature : à confirmer avant de valider (anomalie de paie). */
export function primeRecopieeSansMarqueur(p: Pick<Prime, "recopiee" | "nature">): boolean {
  return Boolean(p.recopiee) && !p.nature;
}

/** Marque une prime ; recopiee retombe à false (la nature a été choisie). */
export function marquerPrime(p: Prime, nature: NaturePrime | undefined): Prime {
  const { nature: _ancienne, ...reste } = p;
  void _ancienne;
  return nature ? { ...reste, nature, recopiee: false } : { ...reste, recopiee: p.recopiee };
}
