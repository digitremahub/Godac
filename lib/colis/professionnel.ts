/**
 * Détection d'une adresse professionnelle à la saisie d'un colis (ajout,
 * scan, photo d'étiquette, import) : forme juridique ou mot-clé métier
 * dans le destinataire ou l'adresse (SARL, SAS, mairie, pharmacie…), ou
 * commerce connu à cette adresse dont le nom correspond.
 *
 * Purement fonctionnel (testé dans lib/colis/__tests__/professionnel.test.ts).
 */

export type RaisonPro = "forme_juridique" | "mot_cle" | "commerce";

export interface DetectionPro {
  pro: boolean;
  /** Nom de l'entreprise ou du commerce retenu (null si inconnu). */
  nom: string | null;
  raison: RaisonPro | null;
}

/** Formes juridiques (comparées en majuscules, mot entier). */
const FORMES = ["SARL", "SAS", "SASU", "EURL", "SA", "SCI", "SNC", "SCOP", "SCEA", "GAEC", "EARL", "SELARL", "SELAS", "SCM", "SCP", "GIE", "EIRL", "ETS", "STE", "CIE"];

/** Mots-clés métier (comparés sans accents, en minuscules, mot entier). */
const MOTS_CLES = [
  "mairie", "commune de", "communaute de communes", "prefecture", "gendarmerie", "caserne", "pompiers", "sdis",
  "pharmacie", "cabinet", "clinique", "hopital", "ehpad", "maison de retraite", "laboratoire", "veterinaire", "kine", "dentaire", "medical",
  "ecole", "college", "lycee", "creche", "universite", "institut",
  "boulangerie", "patisserie", "boucherie", "charcuterie", "epicerie", "superette", "supermarche", "hypermarche", "primeur", "fromagerie", "traiteur",
  "restaurant", "brasserie", "pizzeria", "cafe", "bar tabac", "tabac", "hotel", "auberge", "camping",
  "garage", "carrosserie", "station service", "concession",
  "coiffure", "coiffeur", "esthetique", "institut de beaute", "fleuriste", "opticien", "librairie", "quincaillerie", "bricolage", "jardinerie",
  "banque", "credit agricole", "credit mutuel", "caisse d epargne", "la poste", "bureau de poste", "notaire", "assurance", "agence immobiliere", "immobilier",
  "societe", "entreprise", "etablissements", "ets", "magasin", "boutique", "atelier", "usine", "entrepot", "depot", "zone artisanale", "zone industrielle", "za", "zi", "zac",
  "cooperative", "cave cooperative", "vignobles", "scierie", "menuiserie", "plomberie", "electricite", "maconnerie",
  "association", "office de tourisme", "mediatheque", "bibliotheque", "salle des fetes", "eglise", "paroisse",
  "intermarche", "carrefour", "leclerc", "super u", "hyper u", "auchan", "lidl", "aldi", "casino", "spar", "vival", "netto", "biocoop", "decathlon", "bricomarche", "weldom", "gamm vert",
];

/** Texte comparable : minuscules, sans accents ni ponctuation. */
export function normaliserTexte(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MOTS_VIDES = new Set(["le", "la", "les", "de", "du", "des", "d", "l", "et", "a", "au", "aux", "en", "sur", "chez", "the", "sarl", "sas", "sasu", "eurl", "sa", "ets", "ste", "societe"]);

function jetons(v: string): string[] {
  return normaliserTexte(v)
    .split(" ")
    .filter((t) => t.length >= 2 && !MOTS_VIDES.has(t));
}

/**
 * Ressemblance entre deux noms (0 à 1) : part des mots significatifs du
 * plus court présents dans l'autre. « Boulangerie Martin » / « Martin
 * Boulangerie Pâtisserie » → 1.
 */
export function ressemblanceNoms(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const ja = jetons(a);
  const jb = jetons(b);
  if (!ja.length || !jb.length) return 0;
  const [court, long] = ja.length <= jb.length ? [ja, new Set(jb)] : [jb, new Set(ja)];
  return court.filter((t) => long.has(t)).length / court.length;
}

function formeJuridique(texte: string): boolean {
  const mots = texte.toUpperCase().replace(/[^A-Z0-9.]+/g, " ").replace(/\./g, "").split(" ");
  // « SA » seul est trop ambigu en minuscules ; on l'exige en majuscules dans le texte d'origine.
  return mots.some((m) => FORMES.includes(m) && (m !== "SA" || /\bS\.?A\b/.test(texte)));
}

function motCle(texte: string): boolean {
  const n = ` ${normaliserTexte(texte)} `;
  return MOTS_CLES.some((k) => n.includes(` ${k} `));
}

/** Première ligne de l'adresse si elle ne ressemble pas à une voie (« Mairie, 2 place… »). */
function ligneNom(adresse: string): string | null {
  const premiere = adresse.split(/[,\n]/)[0]?.trim() ?? "";
  if (!premiere || /^\d/.test(premiere) || /\b(rue|route|avenue|chemin|place|impasse|allee|boulevard|bd|lieu dit|lieu-dit|hameau|quartier)\b/i.test(normaliserTexte(premiere))) return null;
  return premiere;
}

/**
 * Le destinataire / l'adresse désignent-ils un professionnel ?
 * `commerces` : lieux nommés trouvés à cette adresse (OpenStreetMap,
 * Google…), le plus proche en premier.
 */
export function detecterProfessionnel(entree: { destinataire?: string | null; adresse: string; commerces?: { nom: string; distanceM: number }[] }): DetectionPro {
  const destinataire = entree.destinataire?.trim() || null;
  const nomAdresse = ligneNom(entree.adresse);
  const candidats = [destinataire, nomAdresse].filter((x): x is string => Boolean(x));

  // Commerce connu dont le nom correspond au destinataire (ou à la 1re ligne de l'adresse).
  for (const c of entree.commerces ?? []) {
    if (candidats.some((t) => ressemblanceNoms(t, c.nom) >= 0.6)) return { pro: true, nom: c.nom, raison: "commerce" };
  }
  for (const t of candidats) {
    if (formeJuridique(t)) return { pro: true, nom: t, raison: "forme_juridique" };
  }
  for (const t of candidats) {
    if (motCle(t)) return { pro: true, nom: t, raison: "mot_cle" };
  }
  return { pro: false, nom: null, raison: null };
}

/**
 * Commerce à retenir pour un professionnel détecté : celui dont le nom
 * correspond, sinon le seul lieu nommé très proche (moins de 25 m) — jamais
 * un commerce voisin choisi au hasard.
 */
export function choisirCommerce<T extends { nom: string; distanceM: number }>(detection: DetectionPro, commerces: T[], destinataire?: string | null): T | null {
  if (!commerces.length) return null;
  const parNom = commerces
    .map((c) => ({ c, s: Math.max(ressemblanceNoms(c.nom, detection.nom), ressemblanceNoms(c.nom, destinataire)) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s || a.c.distanceM - b.c.distanceM)[0];
  if (parNom) return parNom.c;
  if (!detection.pro) return null;
  const proches = commerces.filter((c) => c.distanceM <= 25);
  return proches.length === 1 ? proches[0]! : null;
}
