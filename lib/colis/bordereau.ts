/**
 * Bordereau de tournée DPD (« BORDEREAU DE TOURNEE ») photographié page par
 * page au départ : lecture brute par l'IA (lib/ocr/bordereau.ts, schéma
 * ci-dessous), puis normalisation ici — pays depuis le préfixe « F- »,
 * ville tronquée par « .. », téléphone, type d'arrêt depuis les codes
 * (CR, PRE, RDV…), horaires « 8h15 / 12h15 - 13h30/17h15 », déduplication
 * des pages re-photographiées et des colis, compteur face au total imprimé.
 *
 * Purement fonctionnel (testé dans lib/colis/__tests__/bordereau.test.ts),
 * utilisé côté serveur (route de lecture) et dans l'écran d'import.
 */
import { z } from "zod";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { lirePoids } from "@/lib/colis/poids";
import { detecterProfessionnel } from "@/lib/colis/professionnel";
import type { TypeArret } from "@/lib/colis/livraison";

// ── Lecture brute (sortie structurée de l'IA) ───────────────────────

const texte = z.string().max(1000).nullable();
const nombre = z.number().nonnegative().nullable();

export const colisLuSchema = z.object({
  /** N° de colis (14 chiffres sur un bordereau DPD). */
  numero: texte,
  /** Poids imprimé sur la ligne du colis, en kg. */
  poids_kg: nombre,
});

export const blocLuSchema = z.object({
  position: z.number().int().nonnegative().nullable(),
  /** Codes imprimés à gauche du bloc, tels quels (« CR », « PRE », « PRE /RDV »…). */
  codes: z.array(z.string().max(40)).max(20),
  nom: texte,
  contact: texte,
  /** Rue et numéro, sans code postal ni ville. */
  adresse: texte,
  /** Code pays, code postal et ville tels qu'imprimés : « F-66000 PERPIGNAN », « F-66000 PERPIG.. ». */
  localite: texte,
  telephone: texte,
  /** Expéditeur / donneur d'ordre (« DEPOT …, B-9100 … (DPD 121) »). */
  expediteur: texte,
  colis: z.array(colisLuSchema).max(200),
  /** « N Colis en bon état ». */
  nombre_colis: z.number().int().nonnegative().nullable(),
  /** Poids total du bloc en kg. */
  poids_total_kg: nombre,
  /** Nature des marchandises (« Divers », « Pneus »). */
  nature: texte,
  /** Lignes d'enlèvement, de créneau ou d'horaires, telles qu'imprimées. */
  horaires: texte,
  /** Mentions particulières (« Emargement obligatoire à effectuer sur le PDA »). */
  mentions: texte,
  /** Adresse rappelée entre crochets, sans les crochets. */
  adresse_rappel: texte,
});

export const enteteLueSchema = z.object({
  numero: texte,
  tournee: texte,
  date: texte,
  page: z.number().int().positive().nullable(),
  total_colis: z.number().int().nonnegative().nullable(),
  total_poids_kg: nombre,
  code_barres: texte,
});

export const pageLueSchema = z.object({
  /** false : page floue, coupée ou qui n'est pas un bordereau de tournée. */
  lisible: z.boolean(),
  entete: enteteLueSchema,
  blocs: z.array(blocLuSchema).max(60),
});

export type ColisLu = z.infer<typeof colisLuSchema>;
export type BlocLu = z.infer<typeof blocLuSchema>;
export type EnteteLue = z.infer<typeof enteteLueSchema>;
export type PageLue = z.infer<typeof pageLueSchema>;

// ── Normalisation ───────────────────────────────────────────────────

export type TypeBloc = "livraison" | "ramasse" | "rdv" | "relais";

/** Préfixes pays imprimés devant le code postal (« F-66000 », « B-9100 »). */
const PAYS: Record<string, string> = {
  F: "FR", B: "BE", D: "DE", L: "LU", NL: "NL", CH: "CH", I: "IT", E: "ES", P: "PT", A: "AT", GB: "GB", IRL: "IE", MC: "MC", AND: "AD", PL: "PL", CZ: "CZ", DK: "DK", S: "SE",
};

export interface Localite {
  pays: string | null;
  codePostal: string | null;
  ville: string | null;
  /** Ville coupée à l'impression (« VILLENEUVE DE LA RAH.. »). */
  villeTronquee: boolean;
}

const nettoyer = (v: string | null | undefined): string | null => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/** Ville coupée : se termine par « .. » ou « … ». */
const TRONQUE = /\s*(?:\.{2,}|…)\s*$/;

/** « F-66000 PERPIGNAN » → { pays: "FR", codePostal: "66000", ville: "PERPIGNAN" }. */
export function lireLocalite(brut: string | null | undefined): Localite {
  const t = nettoyer(brut);
  if (!t) return { pays: null, codePostal: null, ville: null, villeTronquee: false };
  const m = t.match(/^(?:([A-Z]{1,3})\s*-\s*)?(\d{4,5})\b[\s,]*(.*)$/i);
  if (!m) {
    const tronquee = TRONQUE.test(t);
    return { pays: null, codePostal: null, ville: nettoyer(t.replace(TRONQUE, "")), villeTronquee: tronquee };
  }
  const prefixe = m[1]?.toUpperCase() ?? null;
  const reste = m[3] ?? "";
  const villeTronquee = TRONQUE.test(reste);
  return {
    pays: prefixe ? (PAYS[prefixe] ?? null) : null,
    codePostal: m[2]!,
    ville: nettoyer(reste.replace(TRONQUE, "").replace(/[,.]+$/, "")),
    villeTronquee,
  };
}

/**
 * Ville complète retrouvée dans l'adresse rappelée entre crochets
 * (« [GARAGE X, F-66000 PERPIGNAN, 1 RUE …] ») quand le même code postal y
 * figure et que la ville n'y est pas elle-même coupée.
 */
export function villeDepuisRappel(rappel: string | null | undefined, codePostal: string | null): string | null {
  if (!rappel || !codePostal) return null;
  for (const morceau of rappel.split(",")) {
    const l = lireLocalite(morceau);
    if (l.codePostal === codePostal && l.ville && !l.villeTronquee) return l.ville.replace(/-/g, " ");
  }
  return null;
}

/**
 * Type d'arrêt depuis les codes imprimés à gauche du bloc : « CR »
 * (enlèvement) → ramasse ; « RDV » → rendez-vous ; relais (« REL »,
 * « RELAIS », « PR », « PICKUP », « P2S ») → point relais ; le reste
 * (« PRE » Predict, code inconnu, aucun code) → livraison.
 */
export function typeDepuisCodes(codes: string[]): TypeBloc {
  const mots = codes.join(" ").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (mots.includes("CR")) return "ramasse";
  if (mots.some((m) => m === "REL" || m === "RELAIS" || m === "PR" || m === "PICKUP" || m === "P2S" || m === "SHOP")) return "relais";
  if (mots.includes("RDV")) return "rdv";
  return "livraison";
}

/** Type d'arrêt GODAC : un rendez-vous reste une livraison (avec une note). */
export function typeArretBloc(type: TypeBloc): TypeArret {
  return type === "ramasse" ? "ramasse" : type === "relais" ? "point_relais" : "livraison";
}

export interface Plage {
  debut: string;
  fin: string;
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const minutes = (p: string) => Number(p.slice(0, 2)) * 60 + Number(p.slice(3, 5));

/**
 * Horaires d'ouverture écrits à la main dans le système DPD : « 8h15 /
 * 12h15 - 13h30/17h15 », « 9h-12h 14h-18h », « 08:00-12:00 ». Les heures
 * sont prises deux à deux, dans l'ordre ; une suite qui ne monte pas est
 * rejetée (null) plutôt que devinée.
 */
export function lirePlages(brut: string | null | undefined): Plage[] | null {
  if (!brut) return null;
  const heures = [...brut.matchAll(/(?<!\d)([01]?\d|2[0-3])\s*(?:[hH]([0-5]\d)?|:([0-5]\d))(?!\d)/g)].map((m) => hhmm(Number(m[1]), Number(m[2] ?? m[3] ?? 0)));
  if (heures.length < 2 || heures.length % 2) return null;
  const plages: Plage[] = [];
  for (let i = 0; i < heures.length; i += 2) plages.push({ debut: heures[i]!, fin: heures[i + 1]! });
  for (let i = 0; i < plages.length; i++) {
    if (minutes(plages[i]!.fin) <= minutes(plages[i]!.debut)) return null;
    if (i && minutes(plages[i]!.debut) < minutes(plages[i - 1]!.fin)) return null;
  }
  return plages;
}

export interface Horaires {
  /** Fenêtre d'enlèvement imprimée après la date (« Enl.: 21/10/26 08:00-18:00 »). */
  fenetre: Plage | null;
  /** Horaires d'ouverture notés après le contact (« ~~~~8h15 / 12h15 - 13h30/17h15 »). */
  plages: Plage[] | null;
  /** Contact sur place (« David (le magasinier) »). */
  contact: string | null;
}

/**
 * Ligne d'enlèvement ou de créneau d'un bloc : « Enl.: 21/10/26
 * 08:00-18:00 2~David (le magasinier)~~~~8h15 / 12h15 - 13h30/17h15 ».
 * Plusieurs lignes identiques (une par colis) donnent le même résultat :
 * seule la première est lue.
 */
export function lireHoraires(brut: string | null | undefined): Horaires {
  const ligne = nettoyer(brut?.split(/\n/).find((l) => l.trim()));
  if (!ligne) return { fenetre: null, plages: null, contact: null };
  let reste = ligne;
  let fenetre: Plage | null = null;
  const f = reste.match(/(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\s+)?([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)/);
  // Fenêtre précédée de la date d'enlèvement seulement : « 08:00-12:00 14:00-18:00 » seul est une suite de plages.
  if (f?.[1]) {
    const debut = hhmm(Number(f[2]), Number(f[3]));
    const fin = hhmm(Number(f[4]), Number(f[5]));
    if (minutes(fin) > minutes(debut)) fenetre = { debut, fin };
    reste = reste.slice((f.index ?? 0) + f[0].length);
  }
  let contact: string | null = null;
  const tildes = reste.split(/~+/);
  if (tildes.length > 1) {
    contact = nettoyer(tildes[1]?.replace(/^\s*\d+\s*/, ""));
    reste = tildes.slice(2).join(" ") || "";
    // « 2~David » : le contact est entre le 1er et le 2e tilde.
    const avant = nettoyer(tildes[0]?.replace(/^\s*\d+\s*$/, ""));
    if (!contact && avant) contact = avant;
  }
  return { fenetre, plages: lirePlages(reste), contact };
}

export type Doute = "nom" | "adresse" | "code_postal" | "ville_tronquee" | "telephone" | "colis" | "poids" | "position";

export const LIBELLE_DOUTE: Record<Doute, string> = {
  nom: "nom absent",
  adresse: "rue absente",
  code_postal: "code postal absent",
  ville_tronquee: "ville tronquée",
  telephone: "téléphone incomplet",
  colis: "n° de colis illisible",
  poids: "poids absent",
  position: "position absente",
};

export interface ArretBordereau {
  /** Clé stable dans l'aperçu (position, sinon numéros de colis). */
  cle: string;
  position: number | null;
  page: number | null;
  type: TypeBloc;
  codes: string[];
  nom: string | null;
  contact: string | null;
  societe: string | null;
  rue: string | null;
  codePostal: string | null;
  ville: string | null;
  pays: string | null;
  telephone: string | null;
  colis: string[];
  nombreColis: number;
  poidsKg: number | null;
  nature: string | null;
  expediteur: string | null;
  horairesTexte: string | null;
  fenetre: Plage | null;
  plages: Plage[] | null;
  mentions: string | null;
  doutes: Doute[];
}

/** Bloc lu → arrêt prêt pour l'aperçu. `pays` : pays de l'entreprise (téléphone). */
export function normaliserBloc(bloc: BlocLu, page: number | null = null, pays = "FR"): ArretBordereau {
  const loc = lireLocalite(bloc.localite);
  const villeRappel = loc.villeTronquee ? villeDepuisRappel(bloc.adresse_rappel, loc.codePostal) : null;
  const ville = villeRappel ?? loc.ville;
  const villeTronquee = loc.villeTronquee && !villeRappel;
  const telBrut = nettoyer(bloc.telephone);
  const telephone = telBrut ? normaliserTelephone(telBrut.replace(TRONQUE, ""), pays) : null;
  const colis = [...new Set(bloc.colis.map((c) => c.numero?.replace(/\D/g, "") ?? "").filter((n) => /^\d{10,20}$/.test(n)))];
  const poidsColis = bloc.colis.reduce((s, c) => s + (c.poids_kg ?? 0), 0);
  const poidsKg = lirePoids(bloc.poids_total_kg) ?? lirePoids(Math.round(poidsColis * 1000) / 1000);
  const type = typeDepuisCodes(bloc.codes);
  const nom = nettoyer(bloc.nom);
  const contact = nettoyer(bloc.contact);
  const rue = nettoyer(bloc.adresse);
  const pro = nom ? detecterProfessionnel({ destinataire: nom, adresse: rue ?? "" }) : null;
  // Destinataire avec un contact entre parenthèses : c'est une société.
  const societe = nom && (pro?.pro || contact) ? nom : null;
  const horaires = lireHoraires(bloc.horaires);
  const doutes: Doute[] = [];
  if (bloc.position === null) doutes.push("position");
  if (!nom) doutes.push("nom");
  if (!rue) doutes.push("adresse");
  if (!loc.codePostal) doutes.push("code_postal");
  if (villeTronquee) doutes.push("ville_tronquee");
  if (telBrut && !telephone) doutes.push("telephone");
  if (bloc.colis.length > colis.length) doutes.push("colis");
  if (!poidsKg && type !== "ramasse") doutes.push("poids");
  return {
    cle: bloc.position !== null ? `pos:${bloc.position}` : colis.length ? `colis:${colis.join(",")}` : `bloc:${page ?? "?"}:${nom ?? ""}:${rue ?? ""}`,
    position: bloc.position,
    page,
    type,
    codes: bloc.codes.map((c) => c.trim()).filter(Boolean),
    nom,
    contact: contact ?? (type === "ramasse" ? horaires.contact : null),
    societe,
    rue,
    codePostal: loc.codePostal,
    ville,
    pays: loc.pays,
    telephone,
    colis,
    nombreColis: bloc.nombre_colis ?? (colis.length || 1),
    poidsKg,
    nature: nettoyer(bloc.nature),
    expediteur: nettoyer(bloc.expediteur),
    horairesTexte: nettoyer(bloc.horaires?.split(/\n/)[0]),
    fenetre: horaires.fenetre,
    plages: horaires.plages,
    mentions: nettoyer(bloc.mentions),
    doutes,
  };
}

// ── En-tête et pages ────────────────────────────────────────────────

export interface Entete {
  /** N° de bordereau, chiffres seuls (« 377,682 » → « 377682 »). */
  numero: string | null;
  tournee: string | null;
  /** Date du bordereau au format AAAA-MM-JJ. */
  date: string | null;
  page: number | null;
  totalColis: number | null;
  totalPoidsKg: number | null;
  codeBarres: string | null;
}

/** « 21.10.2026 », « 21/10/26 » → « 2026-10-21 » ; null si illisible. */
export function lireDate(brut: string | null | undefined): string | null {
  const m = brut?.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/);
  if (!m) return null;
  const a = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]);
  const j = Number(m[1]);
  if (mo < 1 || mo > 12 || j < 1 || j > 31) return null;
  return `${a}-${String(mo).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
}

export function normaliserEntete(e: EnteteLue): Entete {
  const numero = e.numero?.replace(/\D/g, "") || null;
  const codeBarres = e.code_barres?.replace(/\D/g, "") || null;
  return {
    numero,
    tournee: nettoyer(e.tournee),
    date: lireDate(e.date),
    page: e.page,
    totalColis: e.total_colis,
    totalPoidsKg: lirePoids(e.total_poids_kg),
    codeBarres: codeBarres && codeBarres.length >= 8 ? codeBarres : null,
  };
}

export interface PageBordereau {
  entete: Entete;
  arrets: ArretBordereau[];
}

export function normaliserPage(page: PageLue, pays = "FR"): PageBordereau {
  const entete = normaliserEntete(page.entete);
  return { entete, arrets: page.blocs.map((b) => normaliserBloc(b, entete.page, pays)) };
}

/**
 * Identité d'une page : n° de bordereau + n° de page ; à défaut le texte du
 * code-barres (qui code le dépôt, le bordereau et la page) ; null si rien
 * ne permet de la reconnaître (elle est alors gardée telle quelle).
 */
export function clePage(e: Entete): string | null {
  if (e.numero && e.page) return `${e.numero}|${e.page}`;
  if (e.codeBarres) return `cb:${e.codeBarres}`;
  return null;
}

/**
 * Ajoute une page lue à celles déjà lues : une page re-photographiée
 * (même clé) remplace la précédente, à sa place.
 */
export function ajouterPage<T extends PageBordereau>(pages: T[], page: T): T[] {
  const cle = clePage(page.entete);
  const i = cle ? pages.findIndex((p) => clePage(p.entete) === cle) : -1;
  if (i < 0) return [...pages, page];
  return pages.map((p, k) => (k === i ? page : p));
}

/**
 * Arrêts de toutes les pages, dans l'ordre des positions du bordereau,
 * sans doublon : même position (un bloc à cheval sur deux pages, ou deux
 * photos de la même page sans en-tête lisible) ou colis déjà vus. Les
 * colis déjà présents sur un arrêt précédent sont retirés du suivant.
 */
export function fusionnerPages(pages: PageBordereau[]): ArretBordereau[] {
  const parCle = new Map<string, ArretBordereau>();
  const colisVus = new Set<string>();
  const tous = pages.flatMap((p) => p.arrets).sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || (a.page ?? 0) - (b.page ?? 0));
  for (const a of tous) {
    const deja = parCle.get(a.cle);
    if (deja) {
      // Même bloc lu deux fois : on garde la lecture la plus complète.
      if (a.doutes.length < deja.doutes.length) parCle.set(a.cle, a);
      continue;
    }
    const nouveaux = a.colis.filter((c) => !colisVus.has(c));
    if (a.colis.length && !nouveaux.length) continue;
    for (const c of nouveaux) colisVus.add(c);
    parCle.set(a.cle, nouveaux.length === a.colis.length ? a : { ...a, colis: nouveaux, nombreColis: Math.max(nouveaux.length, a.nombreColis - (a.colis.length - nouveaux.length)) });
  }
  return [...parCle.values()];
}

export interface Compteur {
  numero: string | null;
  pagesLues: number;
  /** Pages absentes entre 1 et la plus grande page lue. */
  pagesManquantes: number[];
  colis: number;
  totalColis: number | null;
  poidsKg: number;
  totalPoidsKg: number | null;
  /** Toutes les pages et tous les colis annoncés sont lus. */
  complet: boolean;
  /** Pages d'un autre bordereau que la première lue. */
  autresBordereaux: string[];
}

/** « Pages lues : 3 / ? · Colis : 21 / 131 · Poids : 172 / 986 kg ». */
export function compter(pages: PageBordereau[], arrets = fusionnerPages(pages)): Compteur {
  const numero = pages.find((p) => p.entete.numero)?.entete.numero ?? null;
  const entete = (k: "totalColis" | "totalPoidsKg") => pages.find((p) => p.entete[k] !== null)?.entete[k] ?? null;
  const nums = new Set(pages.map((p) => p.entete.page).filter((n): n is number => n !== null));
  const max = nums.size ? Math.max(...nums) : 0;
  const pagesManquantes = Array.from({ length: max }, (_, i) => i + 1).filter((n) => !nums.has(n));
  const colis = arrets.reduce((s, a) => s + a.nombreColis, 0);
  const poidsKg = Math.round(arrets.reduce((s, a) => s + (a.poidsKg ?? 0), 0) * 100) / 100;
  const totalColis = entete("totalColis");
  const totalPoidsKg = entete("totalPoidsKg");
  return {
    numero,
    pagesLues: pages.length,
    pagesManquantes,
    colis,
    totalColis,
    poidsKg,
    totalPoidsKg,
    complet: Boolean(pages.length && !pagesManquantes.length && totalColis !== null && colis >= totalColis),
    autresBordereaux: [...new Set(pages.map((p) => p.entete.numero).filter((n): n is string => Boolean(n) && n !== numero))],
  };
}

export function libelleCompteur(c: Compteur): string {
  const kg = (n: number) => String(Math.round(n));
  return [
    `Pages lues : ${c.pagesLues} / ${c.complet ? c.pagesLues : "?"}`,
    `Colis : ${c.colis} / ${c.totalColis ?? "?"}`,
    `Poids : ${kg(c.poidsKg)} / ${c.totalPoidsKg !== null ? kg(c.totalPoidsKg) : "?"} kg`,
  ].join(" · ");
}

// ── Vers la tournée ─────────────────────────────────────────────────

/** Adresse géocodable : « 1 RUE DES LILAS, 66000 PERPIGNAN » (+ pays hors France). */
export function adresseComplete(a: Pick<ArretBordereau, "rue" | "codePostal" | "ville" | "pays">): string {
  const localite = [a.codePostal, a.ville].filter(Boolean).join(" ");
  return [a.rue, localite, a.pays && a.pays !== "FR" ? a.pays : null].filter(Boolean).join(", ");
}

/** Notes de l'arrêt : type, nature, expéditeur, horaires, mentions. */
export function notesArret(a: ArretBordereau): string | null {
  const morceaux = [
    a.type === "rdv" ? "Rendez-vous (RDV)" : null,
    a.type === "ramasse" && a.nombreColis ? `Enlèvement : ${a.nombreColis} colis` : null,
    a.codes.length ? `Code DPD : ${a.codes.join(" ")}` : null,
    a.contact ? `Contact : ${a.contact}` : null,
    a.nature ? `Nature : ${a.nature}` : null,
    a.expediteur ? `Expéditeur : ${a.expediteur}` : null,
    a.horairesTexte && !a.plages && !a.fenetre ? `Horaires : ${a.horairesTexte}` : null,
    a.plages && a.plages.length > 1 ? `Horaires : ${a.plages.map((p) => `${p.debut}–${p.fin}`).join(" / ")}` : null,
    a.mentions,
  ].filter(Boolean);
  return morceaux.length ? morceaux.join(" · ").slice(0, 500) : null;
}

/** Point envoyé à /api/colis/arrets/bulk. */
export interface PointBordereau {
  adresse: string;
  lat: null;
  lng: null;
  nom: string | null;
  telephone: string | null;
  code: string | null;
  type: TypeArret;
  colis: number;
  poids: number | null;
  window_start: string | null;
  window_end: string | null;
  plages: Plage[] | null;
  notes: string | null;
  societe: string | null;
  commune: string | null;
  code_postal: string | null;
}

/**
 * Arrêt du bordereau → point d'import : créneau unique (fenêtre
 * d'enlèvement ou une seule plage) en window_start / window_end ; deux
 * plages (pause de midi) vont dans la fiche horaires pro.
 */
export function pointDepuisArret(a: ArretBordereau): PointBordereau {
  const plageUnique = a.plages?.length === 1 ? a.plages[0]! : null;
  const fenetre = plageUnique ?? (a.plages && a.plages.length > 1 ? null : a.fenetre);
  const type = typeArretBloc(a.type);
  return {
    adresse: adresseComplete(a).slice(0, 300),
    lat: null,
    lng: null,
    nom: a.nom?.slice(0, 120) ?? null,
    telephone: a.telephone,
    code: a.colis.length ? a.colis.join(",").slice(0, 120) : null,
    type,
    colis: type === "ramasse" ? 0 : Math.max(1, a.nombreColis),
    poids: a.poidsKg,
    window_start: fenetre?.debut ?? null,
    window_end: fenetre?.fin ?? null,
    plages: a.plages && a.plages.length > 1 ? a.plages.slice(0, 2) : null,
    notes: notesArret(a),
    societe: a.societe?.slice(0, 200) ?? null,
    commune: a.ville,
    code_postal: a.codePostal,
  };
}
