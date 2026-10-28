// Source « professionnels par leur nom » : API publique « Recherche
// d'entreprises » (DINUM, https://recherche-entreprises.api.gouv.fr), gratuite
// et sans clé (≈ 7 requêtes/s par IP). Elle expose le répertoire SIRENE :
// établissements ACTIFS avec raison sociale, enseigne / nom commercial et
// adresse (et, selon les fiches, latitude/longitude).
//
// Fonctions PURES (testées dans lib/colis/__tests__/recherche-entreprises.test.ts) ;
// l'appel réseau est dans recherche-adresses-serveur.ts (`entreprises`).
//
// Le format réel (results[].siege / matching_etablissements[], coordonnées
// parfois en CHAÎNES, adresses en MAJUSCULES, valeurs « [ND] » pour les
// données non diffusibles) n'a pu être vérifié en direct : le lecteur est donc
// volontairement très tolérant (champ absent ou de type inattendu = ignoré,
// jamais d'exception) et on ne conserve rien des réponses.

import type { SuggestionAdresse } from "@/lib/colis/recherche-adresses";

type Objet = Record<string, unknown>;

const objet = (v: unknown): Objet | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Objet) : null);
const texte = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
/** Valeur masquée par la diffusion restreinte (« [ND] ») ou vide. */
const masque = (s: string) => s === "" || /\[nd\]|non[- ]diffusible/i.test(s);

function nombre(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Coordonnées plausibles (l'API les donne parfois en chaînes) ; (0, 0) = géocodage absent. */
export function lireCoordonnees(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = nombre(lat);
  const b = nombre(lng);
  if (a === null || b === null || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
}

const PETITS_MOTS = new Set(["de", "du", "des", "la", "le", "les", "et", "au", "aux", "en", "sur", "sous", "d", "l", "a"]);

/** « 12 RUE DE LA GARE » → « 12 Rue de la Gare » ; un texte déjà en casse mixte est laissé tel quel. */
export function casseTitre(s: string): string {
  if (!s || s !== s.toUpperCase() || s === s.toLowerCase()) return s;
  let premier = true;
  return s
    .replace(/\b([DL]) (?=[AEIOUYH])/g, "$1'") // SIRENE écrit « DE L EGLISE » sans apostrophe
    .toLowerCase()
    .split(/([\s\-'’]+)/)
    .map((m) => {
      if (!/[\p{L}\d]/u.test(m)) return m;
      const mot = !premier && PETITS_MOTS.has(m) ? m : m.charAt(0).toUpperCase() + m.slice(1);
      premier = false;
      return mot;
    })
    .join("");
}

interface AdresseLue {
  rue: string;
  codePostal: string;
  commune: string;
}

/** « 12 Rue X 17000 La Rochelle » → rue / code postal / commune ; null si le code postal manque. */
function decouper(adresse: string): AdresseLue | null {
  const m = /^(.*?)[,\s]+(\d{5})\s+(.+)$/.exec(adresse) ?? /^()(\d{5})\s+(.+)$/.exec(adresse);
  if (!m) return null;
  return { rue: (m[1] ?? "").replace(/[,\s]+$/, "").trim(), codePostal: m[2]!, commune: m[3]!.trim() };
}

/**
 * Adresse postale « n° rue, CP Ville » d'un établissement (ou du siège) ;
 * null sans nom de voie (rien à livrer) ou si l'adresse est non diffusible.
 */
export function lireAdresse(e: Objet): string | null {
  const cp = texte(e.code_postal);
  const commune = texte(e.libelle_commune);
  // geo_adresse (casse et accents corrects) avant adresse (MAJUSCULES, sans accents).
  let lue: AdresseLue | null = null;
  for (const brut of [texte(e.geo_adresse), texte(e.adresse)]) {
    if (!brut || masque(brut)) continue;
    lue = decouper(brut);
    if (lue?.rue) break;
  }
  let rue = lue?.rue ?? "";
  if (!rue) {
    // Reconstitution depuis les éléments de la voie.
    rue = [texte(e.numero_voie), texte(e.indice_repetition), texte(e.type_voie), texte(e.libelle_voie)].filter(Boolean).join(" ");
  }
  if (!rue && texte(e.adresse) && !masque(texte(e.adresse))) {
    // Adresse sans code postal repérable : on retire la fin « CP Commune » connue.
    rue = texte(e.adresse).replace(new RegExp(`[,\\s]*${echapper(cp)}\\s*${echapper(commune)}\\s*$`, "i"), "").trim();
    if (rue === texte(e.adresse) && (cp || commune)) rue = "";
  }
  if (!rue || masque(rue)) return null;
  const codePostal = lue?.codePostal || cp;
  const ville = masque(lue?.commune ?? "") ? commune : lue?.commune || commune;
  if (masque(codePostal) || masque(ville)) return null;
  return `${casseTitre(rue)}, ${[codePostal, casseTitre(ville)].filter(Boolean).join(" ")}`;
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function listeTextes(v: unknown): string[] {
  return Array.isArray(v) ? v.map(texte).filter((s) => !masque(s)) : [];
}

const NATURE_ENTREPRENEUR_INDIVIDUEL = "1000";

interface Nommage {
  nom: string;
  raison: string;
}

/** Nom à afficher (enseigne / nom commercial d'abord) et raison sociale ; null si rien de diffusable. */
function lireNom(e: Objet, entreprise: Objet): Nommage | null {
  const enseigne = [texte(e.nom_commercial), ...listeTextes(e.liste_enseignes)].find((s) => !masque(s)) ?? "";
  const raison = [texte(entreprise.nom_raison_sociale), texte(entreprise.nom_complet)].find((s) => !masque(s)) ?? "";
  // Entrepreneur individuel : le nom complet est celui d'une personne physique ; on ne l'expose que
  // si l'établissement a une enseigne (nom de commerce), jamais le nom de la personne.
  const individuel = texte(entreprise.nature_juridique) === NATURE_ENTREPRENEUR_INDIVIDUEL;
  if (individuel && !enseigne) return null;
  const nom = enseigne || raison;
  if (!nom) return null;
  return { nom: casseTitre(nom).slice(0, 120), raison: individuel ? "" : casseTitre(raison).slice(0, 120) };
}

function actif(o: Objet): boolean {
  return texte(o.etat_administratif).toUpperCase() !== "F" && texte(o.statut_diffusion).toUpperCase() !== "P";
}

function enSuggestion(e: Objet, entreprise: Objet): SuggestionAdresse | null {
  if (!actif(e)) return null;
  const adresse = lireAdresse(e);
  const nommage = lireNom(e, entreprise);
  if (!adresse || !nommage) return null;
  const position = lireCoordonnees(e.latitude, e.longitude);
  const raison = nommage.raison && nommage.raison.toLowerCase() !== nommage.nom.toLowerCase() ? ` · ${nommage.raison}` : "";
  return { type: "pro", nom: nommage.nom, adresse, lat: position?.lat ?? null, lng: position?.lng ?? null, source: "sirene", detail: `Entreprise${raison}` };
}

/**
 * Réponse de /search → suggestions « pro ». Établissements correspondant à la
 * recherche (matching_etablissements) en priorité, sinon le siège. Tolérant :
 * toute entrée inattendue est ignorée, jamais d'exception.
 */
export function lireEntreprises(json: unknown, limite = 8, parEntreprise = 3): SuggestionAdresse[] {
  try {
    const resultats = objet(json)?.results;
    if (!Array.isArray(resultats)) return [];
    const sortie: SuggestionAdresse[] = [];
    for (const brut of resultats) {
      const entreprise = objet(brut);
      if (!entreprise || !actif(entreprise)) continue;
      const etablissements = (Array.isArray(entreprise.matching_etablissements) ? entreprise.matching_etablissements : []).map(objet).filter((o): o is Objet => o !== null);
      const siege = objet(entreprise.siege);
      const sources = etablissements.length > 0 ? etablissements : siege ? [siege] : [];
      let pris = 0;
      for (const e of sources) {
        const s = enSuggestion(e, entreprise);
        if (!s) continue;
        sortie.push(s);
        if (++pris >= parEntreprise) break;
      }
      // Établissements correspondants inutilisables (adresse masquée…) : repli sur le siège.
      if (pris === 0 && etablissements.length > 0 && siege) {
        const s = enSuggestion(siege, entreprise);
        if (s) sortie.push(s);
      }
      if (sortie.length >= limite) break;
    }
    return sortie.slice(0, limite);
  } catch {
    return [];
  }
}

const TYPES_VOIE = "rue|r|avenue|av|ave|bd|bld|boulevard|chemin|ch|impasse|imp|place|pl|route|rte|allee|all|quai|cours|square|passage|lotissement|lot|residence|res|zone|za|zi|zac|hameau|lieu ?dit|voie|sentier|promenade|esplanade|faubourg|fbg|traverse|rond ?point";

const DEBUT_ADRESSE = new RegExp(`^\\d+\\s*(bis|ter|quater|[a-c])?[\\s,]+(${TYPES_VOIE})\\b`, "i");

/**
 * Le texte ressemble-t-il à un NOM (commerce, entreprise) ? Au moins 3 lettres,
 * et ni un numéro seul, ni le début d'une adresse postale (« 12 rue des … »).
 */
export function ressembleAUnNom(q: string): boolean {
  const t = q.trim();
  if ((t.replace(/\b(bis|ter|quater)\b/giu, "").match(/\p{L}/gu) ?? []).length < 3) return false;
  if (DEBUT_ADRESSE.test(t)) return false;
  return true;
}

export interface RequeteEntreprises {
  texte: string;
  codePostal: string | null;
}

/** Texte de recherche débarrassé d'un éventuel code postal (qui devient un filtre) ; null si ce n'est pas un nom. */
export function preparerRequete(q: string): RequeteEntreprises | null {
  const brut = q.trim().replace(/\s+/g, " ");
  const cp = /(?:^|\s)(\d{5})(?=\s|$)/.exec(brut)?.[1] ?? null;
  const sansCp = cp ? brut.replace(cp, " ").replace(/\s+/g, " ").trim() : brut;
  if (!ressembleAUnNom(sansCp)) return null;
  return { texte: sansCp.slice(0, 120), codePostal: cp };
}

const DEPARTEMENT = /^(\d{2}|2[AB]|97\d|98\d)$/i;

/** Département d'une réponse « reverse » de la Base Adresse Nationale (context « 17, Charente-Maritime, … »). */
export function departementDepuisReverse(json: unknown): string | null {
  try {
    const props = objet(Array.isArray(objet(json)?.features) ? (objet(json)!.features as unknown[])[0] : null)?.properties;
    const p = objet(props);
    const contexte = texte(p?.context).split(",")[0]?.trim() ?? "";
    if (DEPARTEMENT.test(contexte)) return contexte.toUpperCase();
    const cp = texte(p?.postcode);
    if (/^\d{5}$/.test(cp) && !cp.startsWith("20")) return cp.startsWith("97") || cp.startsWith("98") ? cp.slice(0, 3) : cp.slice(0, 2);
    return null;
  } catch {
    return null;
  }
}

/** Adresse de la requête /search (filtres facultatifs : code postal du texte, sinon département du biais). */
export function urlRecherche(r: RequeteEntreprises, departement: string | null): string {
  const p = new URLSearchParams({ q: r.texte, per_page: "8", etat_administratif: "A" });
  if (r.codePostal) p.set("code_postal", r.codePostal);
  else if (departement && DEPARTEMENT.test(departement)) p.set("departement", departement);
  return `https://recherche-entreprises.api.gouv.fr/search?${p.toString()}`;
}
