/**
 * « Go! » de GO : lieux enregistrés par l'utilisateur (favoris, récents).
 * Logique pure, sans base ni réseau, testée dans lib/go-lieux/__tests__.
 * Stockage : table go_lieux (migration 20261117000001), une ligne par lieu et
 * par utilisateur ; l'API (app/api/go/lieux) applique les mêmes règles.
 *
 *  - favoris : « Domicile » et « Travail » (un seul de chaque) + 20 favoris nommés au plus ;
 *  - récents : les 10 dernières destinations choisies, purgées après 90 jours
 *    par le cron retention existant (lib/retention/lieux-go.ts) ;
 *  - jamais de trajet ni de position GPS : seuls les lieux choisis sont gardés.
 */
import { z } from "zod";
import { normaliserTexte } from "@/lib/colis/professionnel";

export const MAX_FAVORIS_NOMMES = 20;
export const MAX_RECENTS = 10;
export const RETENTION_RECENTS_JOURS = 90;
export const LIBELLE_MAX = 60;

export type GenreLieu = "favori" | "recent";
export type TypeLieuFixe = "domicile" | "travail";
export const LIBELLES_FIXES: Record<TypeLieuFixe, string> = { domicile: "Domicile", travail: "Travail" };

export interface Lieu {
  id: string;
  genre: GenreLieu;
  /** Domicile ou Travail (favoris seulement) ; null pour un lieu ordinaire. */
  type_lieu: TypeLieuFixe | null;
  libelle: string;
  adresse: string;
  lat: number;
  lng: number;
  dernier_usage: string;
}

/** Ce qu'on envoie pour enregistrer un lieu. */
export const lieuSaisieSchema = z.object({
  libelle: z.string().trim().min(1, "Donnez un nom au lieu.").max(LIBELLE_MAX),
  adresse: z.string().trim().min(3).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LieuSaisie = z.infer<typeof lieuSaisieSchema>;

/** Nom propre : espaces normalisés, caractères de contrôle retirés, 60 caractères au plus. */
export function nettoyerLibelle(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIBELLE_MAX);
}

/** Clé de dédoublonnage : l'adresse sans accents, casse ni ponctuation. */
export function cleLieu(adresse: string): string {
  return normaliserTexte(adresse).slice(0, 200);
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110_540);
}

/** Même lieu : même adresse écrite, ou coordonnées à moins de 25 m. */
export function memeLieu(a: { adresse: string; lat: number; lng: number }, b: { adresse: string; lat: number; lng: number }): boolean {
  return cleLieu(a.adresse) === cleLieu(b.adresse) || distanceM(a, b) < 25;
}

const recent = (a: Lieu, b: Lieu) => Date.parse(b.dernier_usage) - Date.parse(a.dernier_usage);

/**
 * Récents après le choix d'une destination : elle passe en tête (sans doublon),
 * la liste est plafonnée à `max` (les plus anciens disparaissent).
 */
export function ajouterRecent(recents: readonly Lieu[], nouveau: LieuSaisie, id: string, maintenant: Date = new Date(), max: number = MAX_RECENTS): Lieu[] {
  const lieu: Lieu = { id, genre: "recent", type_lieu: null, libelle: nettoyerLibelle(nouveau.libelle) || nettoyerLibelle(nouveau.adresse), adresse: nouveau.adresse.trim(), lat: nouveau.lat, lng: nouveau.lng, dernier_usage: maintenant.toISOString() };
  const autres = recents.filter((r) => !memeLieu(r, lieu));
  return [lieu, ...autres].sort(recent).slice(0, max);
}

export type ResultatFavori = { ok: true; favoris: Lieu[]; lieu: Lieu } | { ok: false; motif: "plafond" | "doublon" | "invalide" };

/**
 * Ajoute un favori. Domicile / Travail remplacent l'existant du même type ;
 * un lieu ordinaire déjà favori n'est pas ajouté deux fois ; au plus
 * MAX_FAVORIS_NOMMES favoris nommés.
 */
export function ajouterFavori(favoris: readonly Lieu[], nouveau: LieuSaisie, id: string, type: TypeLieuFixe | null = null, maintenant: Date = new Date()): ResultatFavori {
  const libelle = type ? LIBELLES_FIXES[type] : nettoyerLibelle(nouveau.libelle);
  if (!libelle || nouveau.adresse.trim().length < 3) return { ok: false, motif: "invalide" };
  const lieu: Lieu = { id, genre: "favori", type_lieu: type, libelle, adresse: nouveau.adresse.trim(), lat: nouveau.lat, lng: nouveau.lng, dernier_usage: maintenant.toISOString() };
  if (type) return { ok: true, lieu, favoris: [...favoris.filter((f) => f.type_lieu !== type), lieu] };
  if (favoris.some((f) => f.type_lieu === null && memeLieu(f, lieu))) return { ok: false, motif: "doublon" };
  if (favoris.filter((f) => f.type_lieu === null).length >= MAX_FAVORIS_NOMMES) return { ok: false, motif: "plafond" };
  return { ok: true, lieu, favoris: [...favoris, lieu] };
}

/** Renomme un favori nommé (Domicile et Travail gardent leur nom). */
export function renommer(lieux: readonly Lieu[], id: string, libelle: string): Lieu[] | null {
  const propre = nettoyerLibelle(libelle);
  const cible = lieux.find((l) => l.id === id);
  if (!propre || !cible || cible.type_lieu) return null;
  return lieux.map((l) => (l.id === id ? { ...l, libelle: propre } : l));
}

export const supprimer = (lieux: readonly Lieu[], id: string): Lieu[] => lieux.filter((l) => l.id !== id);

/** « Tout effacer l'historique » : les récents partent, les favoris restent. */
export const effacerRecents = (lieux: readonly Lieu[]): Lieu[] => lieux.filter((l) => l.genre !== "recent");

/** Domicile, Travail, puis les favoris nommés par ordre alphabétique. */
export function ordonnerFavoris(favoris: readonly Lieu[]): Lieu[] {
  const rang = (l: Lieu) => (l.type_lieu === "domicile" ? 0 : l.type_lieu === "travail" ? 1 : 2);
  return [...favoris].sort((a, b) => rang(a) - rang(b) || a.libelle.localeCompare(b.libelle, "fr"));
}

export const ordonnerRecents = (recents: readonly Lieu[]): Lieu[] => [...recents].sort(recent);

/** Récents plus vieux que 90 jours (ce que la purge supprime). */
export function recentsPerimes(recents: readonly Lieu[], maintenant: Date = new Date()): Lieu[] {
  const limite = maintenant.getTime() - RETENTION_RECENTS_JOURS * 86_400_000;
  return recents.filter((r) => Date.parse(r.dernier_usage) < limite);
}

/** Ligne de la table → lieu valide, sinon null (donnée corrompue ignorée). */
export function lieuDepuisLigne(l: Record<string, unknown>): Lieu | null {
  const lat = Number(l.lat);
  const lng = Number(l.lng);
  if (typeof l.id !== "string" || typeof l.libelle !== "string" || typeof l.adresse !== "string") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const genre = l.genre === "favori" ? "favori" : l.genre === "recent" ? "recent" : null;
  if (!genre) return null;
  const type = l.type_lieu === "domicile" || l.type_lieu === "travail" ? l.type_lieu : null;
  return { id: l.id, genre, type_lieu: type, libelle: l.libelle, adresse: l.adresse, lat, lng, dernier_usage: typeof l.dernier_usage === "string" ? l.dernier_usage : new Date(0).toISOString() };
}

/** Libellé proposé pour un lieu choisi dans les suggestions : nom de l'établissement, sinon début de l'adresse. */
export function libelleDuLieu(s: { nom: string | null; adresse: string }): string {
  return nettoyerLibelle(s.nom ?? s.adresse.split(",")[0] ?? s.adresse);
}
