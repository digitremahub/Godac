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
//     OpenStreetMap complète ensuite (deuxième requête, jamais bloquante).

import { normaliserTexte } from "@/lib/colis/professionnel";

export type TypeSuggestion = "adresse" | "etablissement";
export type SourceSuggestion = "annuaire" | "osm" | "ban" | "google";

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

/** Clé de déduplication : nom + adresse normalisés. */
function cle(s: SuggestionAdresse): string {
  return `${normaliserTexte(s.nom ?? "")}|${normaliserTexte(s.adresse)}`;
}

/**
 * Fusion des sources : annuaire d'abord, puis alternance établissements /
 * adresses (la requête peut viser l'un ou l'autre), sans doublon.
 */
export function fusionnerSuggestions(annuaire: readonly SuggestionAdresse[], externes: readonly SuggestionAdresse[][], limite = 8): SuggestionAdresse[] {
  const vus = new Set<string>();
  const sortie: SuggestionAdresse[] = [];
  const ajouter = (s: SuggestionAdresse) => {
    const k = cle(s);
    if (!s.adresse || vus.has(k) || sortie.length >= limite) return;
    vus.add(k);
    sortie.push(s);
  };
  annuaire.forEach(ajouter);
  const toutes = externes.flat();
  const etab = toutes.filter((s) => s.type === "etablissement");
  const adr = toutes.filter((s) => s.type === "adresse");
  for (let i = 0; i < Math.max(etab.length, adr.length); i++) {
    if (etab[i]) ajouter(etab[i]!);
    if (adr[i]) ajouter(adr[i]!);
  }
  return sortie;
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
 */
export function ordonnerRapide(annuaire: readonly SuggestionAdresse[], principal: readonly SuggestionAdresse[], limite = 8): SuggestionAdresse[] {
  return ajouterSansDoublon([], [...annuaire, ...principal], limite);
}

/**
 * Enrichissement : les suggestions déjà affichées gardent leur place (rien
 * ne saute sous le doigt), les nouvelles s'ajoutent à la suite, établissements
 * et adresses alternés.
 */
export function completerSuggestions(existantes: readonly SuggestionAdresse[], complement: readonly SuggestionAdresse[], limite = 8): SuggestionAdresse[] {
  const etab = complement.filter((s) => s.type === "etablissement");
  const adr = complement.filter((s) => s.type === "adresse");
  const alternes: SuggestionAdresse[] = [];
  for (let i = 0; i < Math.max(etab.length, adr.length); i++) {
    if (etab[i]) alternes.push(etab[i]!);
    if (adr[i]) alternes.push(adr[i]!);
  }
  return ajouterSansDoublon(existantes, alternes, limite);
}

function ajouterSansDoublon(base: readonly SuggestionAdresse[], ajouts: readonly SuggestionAdresse[], limite: number): SuggestionAdresse[] {
  const vus = new Set(base.map(cle));
  const sortie = [...base];
  for (const s of ajouts) {
    const k = cle(s);
    if (!s.adresse || vus.has(k) || sortie.length >= limite) continue;
    vus.add(k);
    sortie.push(s);
  }
  return sortie;
}
