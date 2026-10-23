/** Chaleur d'une piste : nombre de chauffeurs distincts qui recommandent la même entreprise. */
export type Chaleur = "tiede" | "chaude" | "tres_chaude";

export const LIBELLES_CHALEUR: Record<Chaleur, string> = {
  tiede: "Piste tiède",
  chaude: "Piste chaude",
  tres_chaude: "Piste très chaude",
};

/** 1 = tiède, ≥ 2 = chaude, ≥ 3 = très chaude. */
export function chaleurPiste(chauffeursDistincts: number): Chaleur {
  if (chauffeursDistincts >= 3) return "tres_chaude";
  if (chauffeursDistincts >= 2) return "chaude";
  return "tiede";
}

export const STATUTS_RECOMMANDATION = ["nouvelle", "contactee", "essai", "signee", "perdue"] as const;
export type StatutRecommandation = (typeof STATUTS_RECOMMANDATION)[number];

export const LIBELLES_STATUT: Record<StatutRecommandation, string> = {
  nouvelle: "Nouvelle",
  contactee: "Contactée",
  essai: "Essai en cours",
  signee: "Signée",
  perdue: "Perdue",
};

export interface LigneRecommandation {
  id: string;
  referrer_user_id: string | null;
  company_name: string;
  company_key: string;
  status: StatutRecommandation;
  created_at: string;
}

export interface PisteEntreprise<T extends LigneRecommandation = LigneRecommandation> {
  companyKey: string;
  companyName: string;
  chauffeurs: number;
  chaleur: Chaleur;
  lignes: T[];
  derniere: string;
}

/**
 * Regroupe les recommandations par company_key. Chauffeurs distincts =
 * referrer_user_id différents (une ligne dont le chauffeur a été supprimé
 * compte pour un chauffeur à part). Pistes chaudes d'abord, puis les plus
 * récentes. Les lignes d'une piste sont triées de la plus récente à la plus ancienne.
 */
export function grouperPistes<T extends LigneRecommandation>(lignes: readonly T[]): PisteEntreprise<T>[] {
  const groupes = new Map<string, T[]>();
  for (const l of lignes) groupes.set(l.company_key, [...(groupes.get(l.company_key) ?? []), l]);
  const pistes = [...groupes.entries()].map(([companyKey, ls]) => {
    const triees = [...ls].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const chauffeurs = new Set(triees.map((l) => l.referrer_user_id ?? `supprime:${l.id}`)).size;
    return { companyKey, companyName: triees[0]!.company_name, chauffeurs, chaleur: chaleurPiste(chauffeurs), lignes: triees, derniere: triees[0]!.created_at };
  });
  return pistes.sort((a, b) => b.chauffeurs - a.chauffeurs || b.derniere.localeCompare(a.derniere));
}
