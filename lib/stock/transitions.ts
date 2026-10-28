/**
 * Mouvements et statuts d'une unité de stock (fichier pur). Reproduit à
 * l'identique la fonction SQL `stock_transition_autorisee`
 * (supabase/migrations/20261114000002_stock_fonctions.sql) ; le test
 * lib/stock/__tests__/transitions.test.ts garde les deux alignés.
 */

export const TYPES_MOUVEMENT = ["entree", "sortie", "transfert", "retour", "casse", "perte", "ajustement"] as const;
export type TypeMouvement = (typeof TYPES_MOUVEMENT)[number];

export const STATUTS_UNITE = ["dans_depot", "en_tournee", "livre", "retour", "perdu", "endommage"] as const;
export type StatutUnite = (typeof STATUTS_UNITE)[number];

export const LIBELLES_MOUVEMENT: Record<TypeMouvement, string> = {
  entree: "Entrée",
  sortie: "Sortie",
  transfert: "Transfert",
  retour: "Retour",
  casse: "Casse",
  perte: "Perte",
  ajustement: "Ajustement",
};

export const LIBELLES_STATUT: Record<StatutUnite, string> = {
  dans_depot: "En dépôt",
  en_tournee: "En tournée",
  livre: "Livré",
  retour: "Retour",
  perdu: "Perdu",
  endommage: "Endommagé",
};

/** Types qui exigent un motif écrit (casse, perte, ajustement saisis à la main). */
export const TYPES_AVEC_MOTIF: readonly TypeMouvement[] = ["casse", "perte", "ajustement"];

/** Types réservés à l'encadrement (le chauffeur ne corrige pas le stock). */
export const TYPES_ENCADREMENT: readonly TypeMouvement[] = ["ajustement"];

export function estTypeMouvement(v: unknown): v is TypeMouvement {
  return typeof v === "string" && (TYPES_MOUVEMENT as readonly string[]).includes(v);
}

export function estStatutUnite(v: unknown): v is StatutUnite {
  return typeof v === "string" && (STATUTS_UNITE as readonly string[]).includes(v);
}

/** Effet sur le stock : +1 entrée, -1 sortie, 0 transfert ; l'ajustement porte son propre signe. */
export function sensDe(type: TypeMouvement, sensAjustement?: number | null): -1 | 0 | 1 | null {
  switch (type) {
    case "entree":
    case "retour":
      return 1;
    case "sortie":
    case "casse":
    case "perte":
      return -1;
    case "transfert":
      return 0;
    case "ajustement":
      return sensAjustement === 1 ? 1 : sensAjustement === -1 ? -1 : null;
  }
}

/**
 * Statut d'une unité après un mouvement. `avant` vaut null pour une unité
 * inconnue. Pour la sortie : en tournée si une tournée est liée, sinon livrée
 * (sortie définitive). Pour le retour : « retour » (rentrée, à ranger) sauf
 * demande contraire. Renvoie null si le choix demandé n'a pas de sens.
 */
export function statutApres(
  type: TypeMouvement,
  avant: StatutUnite | null,
  options: { sens?: number | null; tournee?: boolean; demande?: StatutUnite | null } = {},
): StatutUnite | null {
  switch (type) {
    case "entree":
      return "dans_depot";
    case "sortie":
      return options.demande ?? (options.tournee ? "en_tournee" : "livre");
    case "transfert":
      return avant;
    case "retour":
      return options.demande ?? "retour";
    case "casse":
      return "endommage";
    case "perte":
      return "perdu";
    case "ajustement":
      return options.sens === 1 ? "dans_depot" : options.sens === -1 ? "perdu" : null;
  }
}

/** Transition permise ? (miroir de public.stock_transition_autorisee) */
export function transitionAutorisee(type: TypeMouvement, sens: number | null, avant: StatutUnite | null, apres: StatutUnite | null): boolean {
  if (apres === null) return false;
  const dans = (liste: readonly StatutUnite[]) => avant !== null && liste.includes(avant);
  switch (type) {
    case "entree":
      return apres === "dans_depot" && (avant === null || dans(["livre", "retour", "perdu", "endommage"]));
    case "sortie":
      return (dans(["dans_depot", "retour"]) && (apres === "en_tournee" || apres === "livre")) || (avant === "en_tournee" && apres === "livre");
    case "transfert":
      return dans(["dans_depot", "retour"]) && apres === avant;
    case "retour":
      return (dans(["en_tournee", "livre"]) && (apres === "retour" || apres === "dans_depot")) || (avant === "retour" && apres === "dans_depot");
    case "casse":
      return dans(["dans_depot", "en_tournee", "retour"]) && apres === "endommage";
    case "perte":
      return dans(["dans_depot", "en_tournee", "retour"]) && apres === "perdu";
    case "ajustement":
      return (
        (sens === 1 && apres === "dans_depot" && (avant === null || dans(["perdu", "endommage", "livre", "retour", "en_tournee"]))) ||
        (sens === -1 && dans(["dans_depot", "retour"]) && apres === "perdu")
      );
  }
}

/** Mouvements proposés pour une unité dans son statut actuel (écran de scan). */
export function mouvementsPossibles(statut: StatutUnite | null): TypeMouvement[] {
  return TYPES_MOUVEMENT.filter((t) => {
    if (t === "ajustement") return false; // saisi à part, avec un motif
    const sens = sensDe(t);
    const options = { tournee: false, sens };
    const apres = statutApres(t, statut, options);
    if (transitionAutorisee(t, sens, statut, apres)) return true;
    // Retour : « remis en stock » est aussi une possibilité.
    return t === "retour" && transitionAutorisee("retour", 1, statut, "dans_depot");
  });
}

/** Statuts comptés « en stock » (physiquement au dépôt). */
export const STATUTS_AU_DEPOT: readonly StatutUnite[] = ["dans_depot", "retour"];
