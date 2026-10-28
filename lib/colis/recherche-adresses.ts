// Recherche d'adresses ET d'établissements (« Pharmacie du Centre
// Saint-X », « Carrefour Market Y ») pour le champ adresse de la tournée
// colis. Fonctions pures (testées dans lib/colis/__tests__/recherche-adresses.test.ts) ;
// les appels réseau sont dans app/api/colis/adresses/recherche/route.ts.
//
// Sources, dans l'ordre d'affichage :
//  1. l'annuaire interne de l'entreprise (delivery_address_hours.label,
//     business_name des arrêts passés) : déjà vérifié par l'équipe ;
//  2. OpenStreetMap (Photon : établissements et adresses, biaisé autour du
//     dépôt ou du chauffeur) et la Base Adresse Nationale (France) ;
//  3. Google Places Autocomplete : source PRINCIPALE si une clé existe
//     (lib/colis/places-google.ts) ; sinon la BAN répond seule et vite, et
//     OpenStreetMap complète ensuite (deuxième requête, jamais bloquante) ;
//  4. professionnels par leur nom : API publique « Recherche d'entreprises »
//     (répertoire SIRENE, gratuite, sans clé ; lib/colis/recherche-entreprises.ts),
//     France seulement et si le texte ressemble à un nom. Ordre : annuaire,
//     professionnels dont le nom correspond au texte, adresses BAN, autres
//     professionnels, puis OpenStreetMap en complément. Avec Google : Google
//     reste prioritaire, les professionnels SIRENE s'ajoutent à la suite.

import { normaliserTexte } from "@/lib/colis/professionnel";

/** « pro » : professionnel / entreprise trouvé par son nom (SIRENE) ; se comporte comme un établissement. */
export type TypeSuggestion = "adresse" | "etablissement" | "pro";
export type SourceSuggestion = "annuaire" | "osm" | "ban" | "google" | "sirene";

/** Lieu nommé (commerce, entreprise) par opposition à une adresse postale seule. */
export const estLieuNomme = (s: Pick<SuggestionAdresse, "type">): boolean => s.type !== "adresse";

export interface SuggestionAdresse {
  type: TypeSuggestion;
  /** Nom de l'établissement (null pour une adresse postale). */
  nom: string | null;
  /** Adresse postale à enregistrer sur l'arrêt. */
  adresse: string;
  lat: number | null;
  lng: number | null;
  source: SourceSuggestion;
  /** Précision affichée (catégorie, ville…). */
  detail?: string | null;
  /** Identifiant Google Places : les coordonnées sont résolues au choix (Place Details). */
  placeId?: string;
}

/** Texte de la suggestion tel qu'affiché et cherché. */
export function libelleSuggestion(s: SuggestionAdresse): string {
  return s.nom ? `${s.nom} — ${s.adresse}` : s.adresse;
}

/** Tous les mots de la requête figurent dans le texte (sans accents ni casse). */
export function correspondRequete(texte: string, requete: string): boolean {
  const t = normaliserTexte(texte);
  const mots = normaliserTexte(requete).split(" ").filter(Boolean);
  return mots.length > 0 && mots.every((m) => t.includes(m));
}

export interface EntreeAnnuaire {
  nom: string | null;
  adresse: string;
  lat?: number | null;
  lng?: number | null;
}

/** Entrées de l'annuaire interne qui correspondent à la requête (nom ou adresse). */
export function filtrerAnnuaire(entrees: readonly EntreeAnnuaire[], requete: string, limite = 5): SuggestionAdresse[] {
  return entrees
    .filter((e) => e.adresse && correspondRequete(`${e.nom ?? ""} ${e.adresse}`, requete))
    .slice(0, limite)
    .map((e) => ({ type: e.nom ? "etablissement" : "adresse", nom: e.nom || null, adresse: e.adresse, lat: e.lat ?? null, lng: e.lng ?? null, source: "annuaire", detail: "Déjà livré par votre équipe" }));
}

/** Propriétés d'un résultat Photon (GeoJSON). */
export interface ProprietesPhoton {
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  district?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
}

const CLES_ETABLISSEMENT = new Set(["shop", "amenity", "office", "craft", "healthcare", "tourism", "leisure", "industrial", "commercial", "company"]);

/** Résultat Photon → suggestion (établissement si c'est un lieu nommé de type commerce/service). */
export function depuisPhoton(p: ProprietesPhoton, coordonnees: [number, number] | null | undefined): SuggestionAdresse | null {
  const ville = p.city || p.town || p.village || "";
  const rue = [p.housenumber, p.street].filter(Boolean).join(" ");
  const adresse = [rue, [p.postcode, ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const etablissement = Boolean(p.name) && CLES_ETABLISSEMENT.has(p.osm_key ?? "");
  const [lng, lat] = coordonnees ?? [null, null];
  if (etablissement) {
    if (!adresse && !ville) return null;
    return { type: "etablissement", nom: p.name!, adresse: adresse || ville, lat, lng, source: "osm", detail: p.osm_value ? libelleCategorie(p.osm_value) : null };
  }
  // Rue ou adresse : sans numéro ni rue, le nom porté par Photon est la rue elle-même.
  const adressePostale = rue ? adresse : [p.name, [p.postcode, ville].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (!adressePostale || !ville) return null;
  return { type: "adresse", nom: null, adresse: adressePostale, lat, lng, source: "osm" };
}

const CATEGORIES: Record<string, string> = {
  pharmacy: "Pharmacie",
  supermarket: "Supermarché",
  convenience: "Supérette",
  bakery: "Boulangerie",
  doctors: "Cabinet médical",
  dentist: "Dentiste",
  restaurant: "Restaurant",
  cafe: "Café",
  bank: "Banque",
  post_office: "Bureau de poste",
  hardware: "Bricolage",
  hairdresser: "Coiffeur",
  car_repair: "Garage",
  townhall: "Mairie",
  school: "École",
};

export function libelleCategorie(osmValue: string): string {
  return CATEGORIES[osmValue] ?? osmValue.replace(/_/g, " ");
}

/**
 * Clés de déduplication : nom + adresse normalisés, et, pour un lieu nommé,
 * nom + code postal + numéro de rue (« 12 Av. de la Gare » = « 12 Avenue de la
 * Gare » venant d'une autre source). Deux suggestions sont des doublons si
 * elles partagent une clé.
 */
function cles(s: SuggestionAdresse): string[] {
  const nom = normaliserTexte(s.nom ?? "");
  const k = [`${nom}|${normaliserTexte(s.adresse)}`];
  const cp = /\b(\d{5})\b/.exec(s.adresse)?.[1];
  const numero = /^\s*(\d+)/.exec(s.adresse)?.[1];
  if (nom && cp && numero) k.push(`${nom}|${cp}|${numero}`);
  return k;
}

/**
 * Fusion des sources : annuaire d'abord, puis alternance établissements /
 * adresses (la requête peut viser l'un ou l'autre), sans doublon.
 */
export function fusionnerSuggestions(annuaire: readonly SuggestionAdresse[], externes: readonly SuggestionAdresse[][], limite = 8): SuggestionAdresse[] {
  const toutes = externes.flat();
  const etab = toutes.filter(estLieuNomme);
  const adr = toutes.filter((s) => !estLieuNomme(s));
  const alternes: SuggestionAdresse[] = [];
  for (let i = 0; i < Math.max(etab.length, adr.length); i++) {
    if (etab[i]) alternes.push(etab[i]!);
    if (adr[i]) alternes.push(adr[i]!);
  }
  return ajouterSansDoublon([], [...annuaire, ...alternes], limite);
}

/** Biais géographique : coordonnées valides, sinon null. */
export function lireBiais(lat: string | null, lng: string | null): { lat: number; lng: number } | null {
  const a = Number(lat);
  const b = Number(lng);
  if (lat === null || lng === null || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

/**
 * Réponse rapide : annuaire interne d'abord, puis la source principale
 * (Google ou BAN) dans SON ordre de pertinence, sans doublon.
 *
 * `pros` : professionnels trouvés par leur nom (SIRENE). Sans Google, ceux dont
 * le nom (ou l'adresse) contient tous les mots de `requete` passent juste après
 * l'annuaire (3 au plus), les autres après les adresses BAN. Avec Google, qui
 * reste prioritaire, ils s'ajoutent à la suite (2 places leur sont réservées).
 */
export function ordonnerRapide(annuaire: readonly SuggestionAdresse[], principal: readonly SuggestionAdresse[], limite = 8, pros: readonly SuggestionAdresse[] = [], requete = ""): SuggestionAdresse[] {
  if (pros.length === 0) return ajouterSansDoublon([], [...annuaire, ...principal], limite);
  const correspond = (s: SuggestionAdresse) => correspondRequete(`${s.nom ?? ""} ${s.detail ?? ""} ${s.adresse}`, requete);
  const nommes = pros.filter(correspond).slice(0, 3);
  const autres = pros.filter((s) => !nommes.includes(s));
  if (principal.some((s) => s.source === "google")) {
    const place = Math.max(0, limite - annuaire.length - Math.min(2, pros.length));
    return ajouterSansDoublon([], [...annuaire, ...principal.slice(0, place), ...nommes, ...autres, ...principal.slice(place)], limite);
  }
  return ajouterSansDoublon([], [...annuaire, ...nommes, ...principal, ...autres], limite);
}

/**
 * Enrichissement : les suggestions déjà affichées gardent leur place (rien
 * ne saute sous le doigt), les nouvelles s'ajoutent à la suite, établissements
 * et adresses alternés.
 */
export function completerSuggestions(existantes: readonly SuggestionAdresse[], complement: readonly SuggestionAdresse[], limite = 8): SuggestionAdresse[] {
  const etab = complement.filter(estLieuNomme);
  const adr = complement.filter((s) => !estLieuNomme(s));
  const alternes: SuggestionAdresse[] = [];
  for (let i = 0; i < Math.max(etab.length, adr.length); i++) {
    if (etab[i]) alternes.push(etab[i]!);
    if (adr[i]) alternes.push(adr[i]!);
  }
  return ajouterSansDoublon(existantes, alternes, limite);
}

function ajouterSansDoublon(base: readonly SuggestionAdresse[], ajouts: readonly SuggestionAdresse[], limite: number): SuggestionAdresse[] {
  const vus = new Set(base.flatMap(cles));
  const sortie = [...base];
  for (const s of ajouts) {
    const k = cles(s);
    if (!s.adresse || k.some((c) => vus.has(c)) || sortie.length >= limite) continue;
    k.forEach((c) => vus.add(c));
    sortie.push(s);
  }
  return sortie;
}
