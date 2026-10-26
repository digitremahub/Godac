/**
 * Ajout d'un village à une fiche de tournée : analyse de la saisie
 * (« Ponteilla 66300 »), suggestions de communes, dédoublonnage et
 * complétion du code postal. Logique pure, sans réseau : la recherche
 * (geo.api.gouv.fr) est faite par la route /api/tour-routes/communes.
 */
import { normaliserRecherche } from "@/lib/tours/recherche-villages";

/** Nombre maximal de suggestions affichées. */
export const MAX_SUGGESTIONS = 6;

/** Une commune telle que renvoyée par geo.api.gouv.fr. */
export interface CommuneApi {
  nom: string;
  code: string;
  codesPostaux?: string[];
  centre?: { type: "Point"; coordinates: [number, number] } | null;
  departement?: { code: string; nom: string } | null;
}

/** Une proposition : une commune + un de ses codes postaux. */
export interface SuggestionCommune {
  name: string;
  postal_code: string;
  departement: string | null;
  departement_code: string | null;
  lat: number | null;
  lng: number | null;
  insee_code: string | null;
}

export interface SaisieVillage {
  /** Nom saisi (sans le code postal). */
  nom: string;
  /** Code postal complet (5 chiffres) trouvé dans la saisie. */
  codePostal: string | null;
}

/** Ce qu'il faut savoir d'un village pour le comparer. */
export interface VillageComparable {
  name: string;
  postal_code: string | null;
}

export const codePostalValide = (cp: string | null | undefined) => /^\d{5}$/.test((cp ?? "").trim());

/** « Ponteilla 66300 » → { nom: "Ponteilla", codePostal: "66300" } ; « 66300 » → nom vide. */
export function analyserSaisie(texte: string): SaisieVillage {
  const brut = texte.trim();
  const codePostal = brut.match(/(?<!\d)(\d{5})(?!\d)/)?.[1] ?? null;
  let nom = codePostal ? brut.replace(codePostal, " ") : brut;
  nom = nom.replace(/\s+/g, " ").replace(/^[\s,;\-–]+|[\s,;\-–]+$/g, "");
  // Des chiffres seuls (« 663 ») ne sont pas un nom de commune.
  if (/^\d+$/.test(nom)) nom = "";
  return { nom, codePostal };
}

/** La saisie permet-elle de chercher (2 lettres, ou un code postal complet) ? */
export const saisieRecherchable = (s: SaisieVillage) => s.nom.length >= 2 || s.codePostal !== null;

/** Rang d'une commune pour un nom saisi : exact, début de nom, contient, autre. */
function rang(nomCommune: string, nomSaisi: string): number {
  if (!nomSaisi) return 0;
  const a = normaliserRecherche(nomCommune);
  const q = normaliserRecherche(nomSaisi);
  if (a === q) return 0;
  if (a.startsWith(q)) return 1;
  if (a.includes(q)) return 2;
  return 3;
}

/**
 * Transforme les communes de l'API (déjà triées par population) en
 * suggestions : une par code postal, exact puis préfixe puis le reste (à
 * rang égal, l'ordre de l'API est conservé), 6 au plus. Avec un code postal
 * saisi, seuls les communes ayant ce code sont gardées ; si aucune ne l'a, le
 * code est ignoré.
 */
export function suggestionsDepuisCommunes(communes: CommuneApi[], saisie: SaisieVillage, max = MAX_SUGGESTIONS): SuggestionCommune[] {
  const toutes = communes.flatMap((c, ordre) =>
    [...(c.codesPostaux ?? [])].sort().map((cp) => ({ c, cp, ordre })),
  );
  const filtrees = saisie.codePostal && toutes.some((t) => t.cp === saisie.codePostal) ? toutes.filter((t) => t.cp === saisie.codePostal) : toutes;
  const triees = filtrees
    .map((t) => ({ ...t, rang: rang(t.c.nom, saisie.nom) }))
    // Pour un code postal seul, ordre alphabétique des communes.
    .sort((a, b) => a.rang - b.rang || (saisie.nom ? a.ordre - b.ordre : a.c.nom.localeCompare(b.c.nom, "fr")) || a.cp.localeCompare(b.cp));
  return triees.slice(0, max).map(({ c, cp }) => {
    const coords = c.centre?.coordinates;
    return {
      name: c.nom,
      postal_code: cp,
      departement: c.departement?.nom ?? null,
      departement_code: c.departement?.code ?? null,
      lat: coords?.length === 2 ? coords[1] : null,
      lng: coords?.length === 2 ? coords[0] : null,
      insee_code: c.code || null,
    };
  });
}

/**
 * Deux villages sont les mêmes si leur nom (sans accents ni casse) est
 * identique et que leurs codes postaux ne diffèrent pas (un code manquant
 * ne les distingue pas : « Toulouges » sans code est « Toulouges 66350 »).
 */
export function memeVillage(a: VillageComparable, b: VillageComparable): boolean {
  if (normaliserRecherche(a.name) !== normaliserRecherche(b.name)) return false;
  const ca = (a.postal_code ?? "").trim();
  const cb = (b.postal_code ?? "").trim();
  return !ca || !cb || ca === cb;
}

/** Position du village déjà présent dans la liste, ou -1. */
export function indexDoublon(villages: VillageComparable[], candidat: VillageComparable): number {
  return villages.findIndex((v) => memeVillage(v, candidat));
}

export type CompletionCodePostal =
  | { statut: "ok"; suggestion: SuggestionCommune }
  | { statut: "ambigu"; candidats: SuggestionCommune[] }
  | { statut: "introuvable" };

/**
 * Code postal d'un village qui n'en a pas, d'après les suggestions trouvées
 * pour son nom : automatique si une seule commune porte exactement ce nom
 * avec un seul code postal ; sinon les candidats sont proposés.
 */
export function completerCodePostal(nom: string, suggestions: SuggestionCommune[]): CompletionCodePostal {
  if (!suggestions.length) return { statut: "introuvable" };
  const cle = normaliserRecherche(nom);
  const exactes = suggestions.filter((s) => normaliserRecherche(s.name) === cle);
  if (exactes.length === 1) return { statut: "ok", suggestion: exactes[0]! };
  return { statut: "ambigu", candidats: exactes.length ? exactes : suggestions };
}

/** Le village avec le nom officiel, le code postal et les coordonnées de la suggestion. */
export function avecSuggestion<T extends VillageComparable>(village: T, s: SuggestionCommune): T & { lat: number | null; lng: number | null; insee_code: string | null } {
  return { ...village, name: s.name, postal_code: s.postal_code, lat: s.lat, lng: s.lng, insee_code: s.insee_code };
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** « 2 ramasses · 1 point relais » (vide s'il n'y a aucun arrêt). */
export function resumeArrets(arrets: { type: "ramasse" | "point_relais" }[]): string {
  const ramasses = arrets.filter((a) => a.type === "ramasse").length;
  const relais = arrets.length - ramasses;
  return [ramasses ? pluriel(ramasses, "ramasse", "ramasses") : "", relais ? pluriel(relais, "point relais", "points relais") : ""].filter(Boolean).join(" · ");
}

/** Libellé court d'une suggestion : « Ponteilla · 66300 (Pyrénées-Orientales) ». */
export const libelleSuggestion = (s: SuggestionCommune) => `${s.name} · ${s.postal_code}${s.departement ? ` (${s.departement})` : ""}`;
