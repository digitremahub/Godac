/**
 * Bordereau de tournée (feuille de route, bordereau de départ) de tout
 * transporteur de messagerie — DPD, GLS, Chronopost, Colissimo, Colis
 * Privé, UPS, DHL, TNT/FedEx, Geodis/Ciblex, Heppner, Relais Colis, Mondial
 * Relay, Amazon… — photographié page par page au départ : lecture brute par
 * l'IA (lib/ocr/bordereau.ts, schéma ci-dessous), puis normalisation ici —
 * transporteur, pays depuis le préfixe (« F- », « B- »), ville tronquée par
 * « .. », téléphone, type d'arrêt depuis les codes ou libellés de service
 * (CR, PRE, RDV, Enlèvement, Point relais…), horaires « 8h15 / 12h15 -
 * 13h30/17h15 », déduplication des pages re-photographiées et des colis,
 * compteur face au total imprimé.
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
// Schéma tolérant : l'IA peut omettre un champ vide, écrire un nombre en
// texte (« 3,5 ») ou rendre une liste trop longue. Ces écarts de forme ne
// doivent pas faire déclarer toute la page illisible : un champ absent ou
// inexploitable vaut null, une liste est bornée, rien n'est inventé.

const enTexte = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  return v.trim() ? v.slice(0, 1000) : null;
};
const enNombre = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".").replace(/[^\d.]+$/, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const liste = (max: number, garder: (x: unknown) => boolean = () => true) => (v: unknown) => (Array.isArray(v) ? v.filter(garder).slice(0, max) : []);
const estObjet = (x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x);

const texte = z.preprocess(enTexte, z.string().nullable());
const nombre = z.preprocess(enNombre, z.number().nullable());
const entier = z.preprocess((v) => {
  const n = enNombre(v);
  return n === null ? null : Math.round(n);
}, z.number().int().nullable());

export const colisLuSchema = z.preprocess(
  // Un n° de colis rendu seul (« 0123… ») au lieu d'un objet.
  (v) => (typeof v === "string" || typeof v === "number" ? { numero: v } : v),
  z.object({
    /** N° de colis (14 chiffres chez DPD, alphanumérique chez d'autres : « 6A12345678901 », « 1Z… »). */
    numero: texte,
    /** Poids imprimé sur la ligne du colis, en kg. */
    poids_kg: nombre,
  }),
);

export const blocLuSchema = z.object({
  /** N° d'ordre imprimé (« Pos », « N° », « Ordre »…), null si la liste n'en a pas. */
  position: entier,
  /** Codes ou libellés de service imprimés, tels quels (« CR », « PRE /RDV », « Enlèvement », « Point relais »…). */
  codes: z.preprocess(
    liste(20, (x) => typeof x === "string" && x.trim() !== ""),
    z.array(z.string().transform((c) => c.slice(0, 40))),
  ),
  nom: texte,
  contact: texte,
  /** Rue et numéro, sans code postal ni ville. */
  adresse: texte,
  /** Code postal et ville tels qu'imprimés, avec le préfixe pays s'il y en a un : « F-66000 PERPIGNAN », « 66000 PERPIG.. ». */
  localite: texte,
  telephone: texte,
  /** Expéditeur / donneur d'ordre (« DEPOT …, B-9100 … (DPD 121) »). */
  expediteur: texte,
  colis: z.preprocess(liste(200, (x) => x !== null && x !== undefined), z.array(colisLuSchema)),
  /** Nombre de colis de l'arrêt (« N Colis en bon état », colonne « Nb colis »). */
  nombre_colis: entier,
  /** Poids total du bloc en kg. */
  poids_total_kg: nombre,
  /** Nature des marchandises (« Divers », « Pneus »). */
  nature: texte,
  /** Lignes d'enlèvement, de créneau ou d'horaires, telles qu'imprimées. */
  horaires: texte,
  /** Mentions particulières (« Emargement obligatoire à effectuer sur le PDA », « Contre-remboursement »). */
  mentions: texte,
  /** Adresse rappelée entre crochets, sans les crochets. */
  adresse_rappel: texte,
});

export const enteteLueSchema = z.object({
  /** Transporteur détecté (logo, nom imprimé), tel quel ; null si rien ne l'indique. */
  transporteur: texte,
  numero: texte,
  tournee: texte,
  date: texte,
  page: z.preprocess((v) => {
    const n = enNombre(v);
    return n !== null && n >= 1 ? Math.round(n) : null;
  }, z.number().int().positive().nullable()),
  total_colis: entier,
  total_poids_kg: nombre,
  code_barres: texte,
});

export const pageLueSchema = z.object({
  /** false : page floue, coupée ou sans liste de colis / d'arrêts. */
  lisible: z.preprocess((v) => v !== false, z.boolean()),
  entete: z.preprocess((v) => (estObjet(v) ? v : {}), enteteLueSchema),
  blocs: z.preprocess(liste(80, estObjet), z.array(blocLuSchema)),
});

export type ColisLu = z.infer<typeof colisLuSchema>;
export type BlocLu = z.infer<typeof blocLuSchema>;
export type EnteteLue = z.infer<typeof enteteLueSchema>;
export type PageLue = z.infer<typeof pageLueSchema>;

// ── Normalisation ───────────────────────────────────────────────────

export type TypeBloc = "livraison" | "ramasse" | "rdv" | "relais";

/** Préfixes pays imprimés devant le code postal : plaques (« F-66000 », « B-9100 ») ou codes ISO (« FR-66000 »). */
const PAYS: Record<string, string> = {
  F: "FR", B: "BE", D: "DE", L: "LU", NL: "NL", CH: "CH", I: "IT", E: "ES", P: "PT", A: "AT", GB: "GB", IRL: "IE", MC: "MC", AND: "AD", PL: "PL", CZ: "CZ", DK: "DK", S: "SE",
  FR: "FR", BE: "BE", DE: "DE", LU: "LU", IT: "IT", ES: "ES", PT: "PT", AT: "AT", IE: "IE", AD: "AD", SE: "SE",
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

/**
 * « F-66000 PERPIGNAN » → { pays: "FR", codePostal: "66000", ville: "PERPIGNAN" } ;
 * aussi « 66000 PERPIGNAN » (sans préfixe) et « PERPIGNAN 66000 » (code
 * postal après la ville, vu sur certaines feuilles de route).
 */
export function lireLocalite(brut: string | null | undefined): Localite {
  const t = nettoyer(brut);
  if (!t) return { pays: null, codePostal: null, ville: null, villeTronquee: false };
  const m = t.match(/^(?:([A-Z]{1,3})\s*-\s*)?(\d{4,5})\b[\s,-]*(.*)$/i);
  const apres = m ? null : t.match(/^(\D+?)[\s,-]+(\d{5})$/);
  if (apres) {
    const villeTronquee = TRONQUE.test(apres[1]!);
    return { pays: null, codePostal: apres[2]!, ville: nettoyer(apres[1]!.replace(TRONQUE, "").replace(/[,.]+$/, "")), villeTronquee };
  }
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

/** Enlèvement chez l'expéditeur : « CR » (DPD), « ENL », « Enlèvement », « Ramasse », « Collecte »… */
const MOTS_RAMASSE = new Set(["CR", "ENL", "ENLEV", "ENLEVEMENT", "ENLEVEMENTS", "RAMASSE", "RAMASSES", "RAMASSAGE", "COLLECTE", "COLLECTES", "COLLECTION"]);
/** Point relais / consigne : « REL », « Pickup » (DPD), « ParcelShop » (GLS), « Pickup Station »… */
const MOTS_RELAIS = new Set(["REL", "RELAIS", "RELAY", "PR", "PICKUP", "P2S", "SHOP", "PARCELSHOP", "PUDO", "LOCKER", "CONSIGNE", "CONSIGNES", "A2P", "BPR", "ACCESSPOINT"]);
/** Rendez-vous : « RDV », « Rendez-vous », « Appointment ». */
const MOTS_RDV = new Set(["RDV", "RENDEZVOUS", "APPOINTMENT", "APPT"]);

/**
 * Type d'arrêt depuis les codes ou libellés de service imprimés : DPD
 * (« CR » enlèvement, « PRE » Predict, « RDV », « REL ») et équivalents
 * courants des autres transporteurs (« Enlèvement », « Collecte »,
 * « Point relais », « ParcelShop », « Consigne », « Rendez-vous »…). Le
 * reste (Predict, express, code inconnu, aucun code) → livraison.
 */
export function typeDepuisCodes(codes: string[]): TypeBloc {
  const t = codes
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    // « Rendez-vous », « Point relais », « Access Point », « Pickup Station » : mots composés recollés.
    .replace(/RENDEZ\W*VOUS/g, "RENDEZVOUS")
    .replace(/POINTS?\W*RELAIS/g, "RELAIS")
    .replace(/ACCESS\W*POINT/g, "ACCESSPOINT")
    .replace(/PARCEL\W*SHOP/g, "PARCELSHOP")
    .replace(/PICK\W*UP/g, "PICKUP");
  const mots = t.split(/[^A-Z0-9]+/).filter(Boolean);
  if (mots.some((m) => MOTS_RAMASSE.has(m))) return "ramasse";
  if (mots.some((m) => MOTS_RELAIS.has(m))) return "relais";
  if (mots.some((m) => MOTS_RDV.has(m))) return "rdv";
  return "livraison";
}

/**
 * N° de colis lu : lettres et chiffres seuls, en majuscules. Le n° DPD
 * (14 chiffres) perd sa lettre de contrôle ; les autres formats sont
 * gardés tels quels (Colissimo « 6A… », UPS « 1Z… », GLS, Chronopost
 * « XY…FR »). Trop court, trop long ou presque sans chiffre : null.
 */
export function lireNumeroColis(brut: string | null | undefined): string | null {
  const t = brut?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return null;
  const dpd = t.match(/^(\d{14})[A-Z]$/);
  if (dpd) return dpd[1]!;
  if (t.length < 8 || t.length > 35) return null;
  return (t.match(/\d/g)?.length ?? 0) >= 6 ? t : null;
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
 * Horaires d'ouverture saisis dans le système du transporteur : « 8h15 /
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
  /** Nombre de lignes du bordereau regroupées dans cet arrêt (même nom et même adresse) ; absent = 1. */
  lignes?: number;
}

/** Bloc lu → arrêt prêt pour l'aperçu. `pays` : pays de l'entreprise (téléphone). */
export function normaliserBloc(bloc: BlocLu, page: number | null = null, pays = "FR"): ArretBordereau {
  const loc = lireLocalite(bloc.localite);
  const villeRappel = loc.villeTronquee ? villeDepuisRappel(bloc.adresse_rappel, loc.codePostal) : null;
  const ville = villeRappel ?? loc.ville;
  const villeTronquee = loc.villeTronquee && !villeRappel;
  const telBrut = nettoyer(bloc.telephone);
  const telephone = telBrut ? normaliserTelephone(telBrut.replace(TRONQUE, ""), pays) : null;
  const colis = [...new Set(bloc.colis.map((c) => lireNumeroColis(c.numero)).filter((n): n is string => n !== null))];
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
  /** Transporteur détecté (« DPD », « GLS », « Colissimo »…), null s'il n'est pas indiqué. */
  transporteur: string | null;
  /** N° de bordereau sans séparateurs (« 377,682 » → « 377682 »). */
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

/** Noms connus, du plus précis au plus général (« Relais Colis » avant « Colis Privé »). */
const TRANSPORTEURS: [RegExp, string][] = [
  [/\bDPD\b|PREDICT|EXAPAQ/i, "DPD"],
  [/\bGLS\b/i, "GLS"],
  [/CHRONO/i, "Chronopost"],
  [/COLISSIMO/i, "Colissimo"],
  [/RELAIS\s*COLIS/i, "Relais Colis"],
  [/MONDIAL\s*RELAY/i, "Mondial Relay"],
  [/COLIS\s*PRIV/i, "Colis Privé"],
  [/\bUPS\b/i, "UPS"],
  [/\bDHL\b/i, "DHL"],
  [/\bTNT\b/i, "TNT"],
  [/FED\s*EX/i, "FedEx"],
  [/CIBLEX/i, "Ciblex"],
  [/GEODIS/i, "Geodis"],
  [/HEPPNER/i, "Heppner"],
  [/SCHENKER/i, "DB Schenker"],
  [/AMAZON|\bAMZL\b/i, "Amazon"],
  [/LA\s*POSTE/i, "La Poste"],
];

/** « dpd france », « GLS France » → « DPD », « GLS » ; un nom inconnu est gardé tel quel. */
export function lireTransporteur(brut: string | null | undefined): string | null {
  const t = nettoyer(brut);
  if (!t) return null;
  return TRANSPORTEURS.find(([re]) => re.test(t))?.[1] ?? t.slice(0, 40);
}

export function normaliserEntete(e: EnteteLue): Entete {
  // N° de bordereau sans séparateurs (« 377,682 » → « 377682 ») ; lettres gardées en majuscules.
  const numero = e.numero?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40) || null;
  const codeBarres = e.code_barres?.replace(/\D/g, "") || null;
  return {
    transporteur: lireTransporteur(e.transporteur),
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

/**
 * Page lue → en-tête et arrêts. Une liste sans n° d'ordre ou sans poids
 * (fréquent hors DPD) ne signale pas « position absente » / « poids
 * absent » sur chaque ligne : le doute ne vaut que si d'autres lignes de
 * la page en ont un.
 */
export function normaliserPage(page: PageLue, pays = "FR"): PageBordereau {
  const entete = normaliserEntete(page.entete);
  let arrets = page.blocs.map((b) => normaliserBloc(b, entete.page, pays));
  const sansPosition = arrets.every((a) => a.position === null);
  const sansPoids = arrets.every((a) => a.poidsKg === null);
  if (sansPosition || sansPoids) arrets = arrets.map((a) => ({ ...a, doutes: a.doutes.filter((d) => !(d === "position" && sansPosition) && !(d === "poids" && sansPoids)) }));
  return { entete, arrets };
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

const lettres = (v: string | null) => (v ?? "").normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const differents = (x: string, y: string) => Boolean(x && y && !x.startsWith(y) && !y.startsWith(x));

/**
 * Deux lectures du même arrêt ? Un colis en commun suffit ; sinon elles
 * diffèrent seulement si le destinataire ET la rue (ou le code postal)
 * diffèrent — un bloc coupé en bas de page, ou relu avec une faute, reste
 * le même arrêt.
 */
export function memeArret(a: ArretBordereau, b: ArretBordereau): boolean {
  if (a.colis.some((c) => b.colis.includes(c))) return true;
  if (a.colis.length && b.colis.length && !a.nom && !b.nom) return false;
  return !(differents(lettres(a.nom), lettres(b.nom)) && (differents(lettres(a.rue), lettres(b.rue)) || differents(a.codePostal ?? "", b.codePostal ?? "")));
}

/**
 * Arrêts de toutes les pages, dans l'ordre du bordereau, sans doublon.
 *
 * Ordre : celui des positions (DPD numérote tout le bordereau, ce qui
 * remet en ordre des photos prises dans le désordre) ; si la numérotation
 * repart à 1 à chaque page (même position, destinataires différents sur
 * deux photos), ordre des pages puis des positions. Les lignes sans
 * position gardent l'ordre de la page.
 *
 * Doublons : même position et même arrêt (bloc à cheval sur deux pages,
 * page photographiée deux fois sans en-tête lisible) → une seule lecture,
 * la plus complète, avec les colis des deux ; colis déjà vus sur un arrêt
 * précédent retirés du suivant.
 */
export function fusionnerPages(pages: PageBordereau[]): ArretBordereau[] {
  const items = pages.flatMap((p, photo) => p.arrets.map((a, rang) => ({ a, photo, rang, page: p.entete.page })));
  const parPosition = new Map<number, typeof items>();
  for (const it of items) if (it.a.position !== null) parPosition.set(it.a.position, [...(parPosition.get(it.a.position) ?? []), it]);
  const numerotationParPage = [...parPosition.values()].some((l) => l.some((x) => l.some((y) => x.photo !== y.photo && !memeArret(x.a, y.a))));
  const ordrePage = (x: (typeof items)[number], y: (typeof items)[number]) => (x.page !== null && y.page !== null ? x.page - y.page : x.photo - y.photo);
  const ordrePosition = (x: (typeof items)[number], y: (typeof items)[number]) => (x.a.position ?? Infinity) - (y.a.position ?? Infinity);
  items.sort((x, y) =>
    numerotationParPage
      ? ordrePage(x, y) || ordrePosition(x, y) || x.rang - y.rang
      : ordrePosition(x, y) || (x.page ?? Infinity) - (y.page ?? Infinity) || x.photo - y.photo || x.rang - y.rang,
  );

  const sortie: ArretBordereau[] = [];
  const cles = new Set<string>();
  const colisVus = new Set<string>();
  for (const { a, photo } of items) {
    const i = sortie.findIndex((s) => (a.position !== null ? s.position === a.position : s.cle === a.cle) && memeArret(s, a));
    if (i >= 0) {
      // Même arrêt lu deux fois : la lecture la plus complète, avec les colis des deux.
      const deja = sortie[i]!;
      const base = a.doutes.length < deja.doutes.length ? { ...a, cle: deja.cle } : deja;
      const ajout = [...deja.colis, ...a.colis].filter((c, k, t) => t.indexOf(c) === k && (deja.colis.includes(c) || !colisVus.has(c)));
      for (const c of ajout) colisVus.add(c);
      sortie[i] = { ...base, colis: ajout, nombreColis: Math.max(base.nombreColis, ajout.length) };
      continue;
    }
    const nouveaux = a.colis.filter((c) => !colisVus.has(c));
    if (a.colis.length && !nouveaux.length) continue;
    for (const c of nouveaux) colisVus.add(c);
    const cle = cles.has(a.cle) ? `${a.cle}@${a.page ?? `photo${photo}`}` : a.cle;
    cles.add(cle);
    sortie.push(nouveaux.length === a.colis.length ? { ...a, cle } : { ...a, cle, colis: nouveaux, nombreColis: Math.max(nouveaux.length, a.nombreColis - (a.colis.length - nouveaux.length)) });
  }
  return regrouperMemeAdresse(sortie);
}

/**
 * Lignes du bordereau qui ont le MÊME destinataire à la MÊME adresse (un
 * point relais qui reçoit 18 colis, une société avec plusieurs bons) :
 * un seul arrêt, avec tous les colis, le poids total et la position de la
 * première ligne. Même type d'arrêt seulement (une ramasse reste à part
 * d'une livraison), nom, rue et code postal identiques et non vides.
 */
export function regrouperMemeAdresse(arrets: ArretBordereau[]): ArretBordereau[] {
  const sortie: ArretBordereau[] = [];
  const index = new Map<string, number>();
  for (const a of arrets) {
    const nom = lettres(a.nom);
    const rue = lettres(a.rue);
    if (!nom || !rue) {
      sortie.push(a);
      continue;
    }
    const cle = `${typeArretBloc(a.type)}|${nom}|${rue}|${a.codePostal ?? ""}`;
    const i = index.get(cle);
    if (i === undefined) {
      index.set(cle, sortie.length);
      sortie.push(a);
      continue;
    }
    const base = sortie[i]!;
    const colis = [...new Set([...base.colis, ...a.colis])];
    const poids = base.poidsKg === null && a.poidsKg === null ? null : Math.round(((base.poidsKg ?? 0) + (a.poidsKg ?? 0)) * 1000) / 1000;
    const positions = [base.position, a.position].filter((n): n is number => n !== null);
    sortie[i] = {
      ...base,
      position: positions.length ? Math.min(...positions) : null,
      codes: [...new Set([...base.codes, ...a.codes])],
      colis,
      nombreColis: base.nombreColis + a.nombreColis,
      poidsKg: poids,
      contact: base.contact ?? a.contact,
      telephone: base.telephone ?? a.telephone,
      horairesTexte: base.horairesTexte ?? a.horairesTexte,
      fenetre: base.fenetre ?? a.fenetre,
      plages: base.plages ?? a.plages,
      mentions: [...new Set([base.mentions, a.mentions].filter((m): m is string => Boolean(m)))].join(" · ") || null,
      doutes: [...new Set([...base.doutes, ...a.doutes])].filter((d) => !(d === "position" && positions.length) && !(d === "poids" && poids)),
      lignes: (base.lignes ?? 1) + (a.lignes ?? 1),
    };
  }
  return sortie;
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

/** Notes de l'arrêt : type, codes du transporteur, nature, expéditeur, horaires, mentions. */
export function notesArret(a: ArretBordereau, transporteur: string | null = null): string | null {
  const morceaux = [
    a.type === "rdv" ? "Rendez-vous (RDV)" : null,
    a.type === "ramasse" && a.nombreColis ? `Enlèvement : ${a.nombreColis} colis` : null,
    a.codes.length ? `Code ${transporteur ?? "bordereau"} : ${a.codes.join(" ")}` : null,
    a.contact ? `Contact : ${a.contact}` : null,
    a.nature ? `Nature : ${a.nature}` : null,
    a.expediteur ? `Expéditeur : ${a.expediteur}` : null,
    a.horairesTexte && !a.plages && !a.fenetre ? `Horaires : ${a.horairesTexte}` : null,
    a.plages && a.plages.length > 1 ? `Horaires : ${a.plages.map((p) => `${p.debut}–${p.fin}`).join(" / ")}` : null,
    a.lignes && a.lignes > 1 ? `${a.lignes} lignes du bordereau regroupées (même destinataire, même adresse)` : null,
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

/** Longueur maximale de la liste des n° de colis acceptée par /api/colis/arrets/bulk. */
export const CODES_MAX = 1000;

/** N° de colis séparés par des virgules, sans jamais couper un n° en deux. */
export function codesColis(colis: string[]): string | null {
  let out = "";
  for (const c of colis) {
    const suivant = out ? `${out},${c}` : c;
    if (suivant.length > CODES_MAX) break;
    out = suivant;
  }
  return out || null;
}

/**
 * Arrêt du bordereau → point d'import : créneau unique (fenêtre
 * d'enlèvement ou une seule plage) en window_start / window_end ; deux
 * plages (pause de midi) vont dans la fiche horaires pro.
 */
export function pointDepuisArret(a: ArretBordereau, transporteur: string | null = null): PointBordereau {
  const plageUnique = a.plages?.length === 1 ? a.plages[0]! : null;
  const fenetre = plageUnique ?? (a.plages && a.plages.length > 1 ? null : a.fenetre);
  const type = typeArretBloc(a.type);
  return {
    adresse: adresseComplete(a).slice(0, 300),
    lat: null,
    lng: null,
    nom: a.nom?.slice(0, 120) ?? null,
    telephone: a.telephone,
    code: codesColis(a.colis),
    type,
    colis: type === "ramasse" ? 0 : Math.max(1, a.nombreColis),
    poids: a.poidsKg,
    window_start: fenetre?.debut ?? null,
    window_end: fenetre?.fin ?? null,
    plages: a.plages && a.plages.length > 1 ? a.plages.slice(0, 2) : null,
    notes: notesArret(a, transporteur),
    societe: a.societe?.slice(0, 200) ?? null,
    commune: a.ville,
    code_postal: a.codePostal,
  };
}
