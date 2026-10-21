// Registre unique du personnel (art. L1221-13 et D1221-23 du code du
// travail) : une ligne par salarié, dans l'ordre des embauches, avec les
// mentions obligatoires, et le signalement des mentions manquantes.
// Fichier pur (écran, PDF, CSV, formulaire), testé dans
// lib/registre/__tests__/personnel.test.ts.
//
// Sources : users (nom affiché, emploi, actif), employee_files (contrat,
// dates, naissance, qualification, nom / prénoms, sexe, sortie — migration
// 20261026000001), employee_register_private (nationalité, titre de
// travail : direction et salarié lui-même seulement), payroll_profiles
// (coefficient, heures du contrat pour le temps partiel).

import { dateFr, documentCsv, type Cellule } from "@/lib/paie/csv";

export const TYPES_CONTRAT = ["cdi", "cdd", "interim", "apprentissage", "professionnalisation", "stage"] as const;
export type TypeContrat = (typeof TYPES_CONTRAT)[number];

export const LIBELLES_CONTRAT: Record<TypeContrat, string> = {
  cdi: "CDI",
  cdd: "CDD",
  interim: "Intérim (mise à disposition)",
  apprentissage: "Apprentissage",
  professionnalisation: "Professionnalisation",
  stage: "Stage (convention)",
};

export const SEXES = { F: "Femme", M: "Homme" } as const;
export type Sexe = keyof typeof SEXES;

export interface EntreeRegistre {
  userId: string;
  /** users.full_name, affiché si nom / prénoms ne sont pas encore séparés. */
  nomAffiche: string;
  nom: string | null;
  prenoms: string | null;
  nationalite: string | null;
  dateNaissance: string | null;
  sexe: Sexe | null;
  emploi: string | null;
  qualification: string | null;
  dateEntree: string | null;
  dateSortie: string | null;
  typeContrat: string | null;
  tempsPartiel: boolean;
  /** Entreprise de travail temporaire (intérim). */
  agenceInterim: string | null;
  titreTravailType: string | null;
  titreTravailNumero: string | null;
  /** Compte actif dans GODAC (un compte désactivé est un salarié sorti). */
  actif: boolean;
}

const sansAccents = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Nationalités dispensées de titre de travail : France, Union
 * européenne, Espace économique européen et Suisse (radical masculin,
 * sans accent).
 */
const DISPENSES_TITRE = [
  "francais", "france", "allemand", "autrichien", "belge", "bulgare", "chypriote", "croate", "danois", "espagnol", "estonien",
  "finlandais", "grec", "hongrois", "irlandais", "italien", "letton", "lituanien", "luxembourgeois", "maltais", "neerlandais",
  "hollandais", "polonais", "portugais", "roumain", "slovaque", "slovene", "suedois", "tcheque", "islandais", "liechtensteinois",
  "norvegien", "suisse",
];

/** Un titre autorisant à travailler est exigé (étranger hors UE / EEE / Suisse). Nationalité inconnue : non. */
export function titreTravailRequis(nationalite: string | null | undefined): boolean {
  const n = sansAccents(nationalite ?? "");
  if (!n) return false;
  return !DISPENSES_TITRE.some((d) => n === d || (n.startsWith(d) && n.length <= d.length + 3));
}

/** Salarié sorti : compte désactivé ou date de sortie passée. */
export function estSorti(e: Pick<EntreeRegistre, "actif" | "dateSortie">, aujourdhui: string): boolean {
  return !e.actif || Boolean(e.dateSortie && e.dateSortie <= aujourdhui);
}

/** Mentions obligatoires absentes (libellés affichés à la direction). */
export function champsManquants(e: EntreeRegistre): string[] {
  const manque: string[] = [];
  if (!e.nom?.trim()) manque.push("Nom");
  if (!e.prenoms?.trim()) manque.push("Prénoms");
  if (!e.nationalite?.trim()) manque.push("Nationalité");
  if (!e.dateNaissance) manque.push("Date de naissance");
  if (!e.sexe) manque.push("Sexe");
  if (!e.emploi?.trim()) manque.push("Emploi");
  if (!e.qualification?.trim()) manque.push("Qualification");
  if (!e.dateEntree) manque.push("Date d'entrée");
  if (!e.typeContrat) manque.push("Type de contrat");
  if (e.typeContrat === "interim" && !e.agenceInterim?.trim()) manque.push("Entreprise de travail temporaire");
  if (!e.actif && !e.dateSortie) manque.push("Date de sortie");
  if (titreTravailRequis(e.nationalite)) {
    if (!e.titreTravailType?.trim()) manque.push("Type du titre de travail");
    if (!e.titreTravailNumero?.trim()) manque.push("N° du titre de travail");
  }
  if (e.dateSortie && e.dateEntree && e.dateSortie < e.dateEntree) manque.push("Date de sortie antérieure à l'entrée");
  return manque;
}

/** Ordre du registre : date d'entrée croissante (inconnues à la fin), puis nom. */
export function ordreRegistre<T extends Pick<EntreeRegistre, "dateEntree" | "nom" | "nomAffiche">>(entrees: readonly T[]): T[] {
  return [...entrees].sort((a, b) => {
    if (a.dateEntree !== b.dateEntree) {
      if (!a.dateEntree) return 1;
      if (!b.dateEntree) return -1;
      return a.dateEntree < b.dateEntree ? -1 : 1;
    }
    return (a.nom ?? a.nomAffiche).localeCompare(b.nom ?? b.nomAffiche, "fr");
  });
}

export function libelleContrat(e: Pick<EntreeRegistre, "typeContrat" | "tempsPartiel" | "agenceInterim">): string {
  if (!e.typeContrat) return "";
  const base = LIBELLES_CONTRAT[e.typeContrat as TypeContrat] ?? e.typeContrat;
  const agence = e.typeContrat === "interim" && e.agenceInterim ? ` — ${e.agenceInterim}` : "";
  return `${base}${e.tempsPartiel ? ", temps partiel" : ""}${agence}`;
}

export function titreTravail(e: Pick<EntreeRegistre, "titreTravailType" | "titreTravailNumero">): string {
  return [e.titreTravailType, e.titreTravailNumero ? `n° ${e.titreTravailNumero}` : null].filter(Boolean).join(" ");
}

export const ENTETE_REGISTRE: readonly string[] = [
  "N° d'ordre",
  "Nom",
  "Prénoms",
  "Nationalité",
  "Date de naissance",
  "Sexe",
  "Emploi",
  "Qualification",
  "Date d'entrée",
  "Date de sortie",
  "Type de contrat",
  "Titre de travail (type et n°)",
  "Mentions manquantes",
];

export function ligneRegistre(rang: number, e: EntreeRegistre): Cellule[] {
  return [
    rang,
    e.nom ?? e.nomAffiche,
    e.prenoms,
    e.nationalite,
    dateFr(e.dateNaissance),
    e.sexe ? SEXES[e.sexe] : "",
    e.emploi,
    e.qualification,
    dateFr(e.dateEntree),
    dateFr(e.dateSortie),
    libelleContrat(e),
    titreTravail(e),
    champsManquants(e).join(", "),
  ];
}

/** Salariés, puis stagiaires dans une partie distincte (art. L1221-13), chacun dans l'ordre d'arrivée. */
export function partiesRegistre<T extends Pick<EntreeRegistre, "dateEntree" | "nom" | "nomAffiche" | "typeContrat">>(entrees: readonly T[]): { salaries: T[]; stagiaires: T[] } {
  const ordre = ordreRegistre(entrees);
  return { salaries: ordre.filter((e) => e.typeContrat !== "stage"), stagiaires: ordre.filter((e) => e.typeContrat === "stage") };
}

export function csvRegistre(entrees: readonly EntreeRegistre[]): string {
  const { salaries, stagiaires } = partiesRegistre(entrees);
  const lignes = [...salaries.map((e, i) => ligneRegistre(i + 1, e)), ...stagiaires.map((e, i) => ligneRegistre(i + 1, e))];
  // Le rang est un entier : pas de « 1,00 » ; les stagiaires sont numérotés à part (« S1 »).
  return documentCsv(
    ENTETE_REGISTRE,
    lignes.map((l, i) => [i < salaries.length ? String(l[0]) : `S${l[0]}`, ...l.slice(1)]),
  );
}

/** Temps partiel : heures du contrat sous la durée légale (151,67 h). */
export function tempsPartiel(heuresContrat: number | null | undefined): boolean {
  return heuresContrat !== null && heuresContrat !== undefined && Number(heuresContrat) > 0 && Number(heuresContrat) < 151.67;
}

/** Valeur de sexe enregistrée → type, ou null. */
export function sexeValide(v: unknown): Sexe | null {
  return v === "F" || v === "M" ? v : null;
}
