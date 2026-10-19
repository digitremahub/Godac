/**
 * Rangement des adresses d'une tournée colis par village.
 *
 * Une tournée du planning (tour_routes) dessert des villages
 * (tour_route_villages, avec code postal et coordonnées de la commune) ;
 * la fiche colis du jour a une liste par village (delivery_lists.village_id).
 * Chaque adresse ajoutée (scan, photo d'étiquette, saisie, import) rejoint
 * la liste de son village :
 *   1. commune de l'adresse = nom du village (et même code postal si les
 *      deux sont connus) ;
 *   2. sinon, coordonnées proches du centre d'un village (hameau, lieu-dit,
 *      commune mal écrite) ;
 *   3. sinon, liste « Hors tournée ».
 *
 * Purement fonctionnel (testé dans lib/colis/__tests__/villages.test.ts).
 */
import { distanceKm, type Point } from "@/lib/colis/optimisation";

export const LISTE_HORS_TOURNEE = "Hors tournée";

/**
 * Rayon (km) autour du centre d'un village quand la commune de l'adresse
 * n'est pas connue. Les communes rurales ont souvent des hameaux à 2–3 km
 * du bourg.
 */
export const RAYON_VILLAGE_KM = 3;
/** Rayon (km) quand la commune est connue mais ne correspond à aucun village (lieu-dit pris pour la commune…). */
export const RAYON_COMMUNE_DIFFERENTE_KM = 1.2;

export interface VillageRef {
  id: string;
  name: string;
  postal_code?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
}

/** Nom de commune comparable : « Saint-Jean-de-Fos » = « st jean de fos » = « ST JEAN DE FOS ». */
export function cleCommune(nom: string): string {
  return nom
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bcedex\b.*$/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bste\b/g, "sainte")
    .replace(/\bst\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Commune et code postal d'une adresse française saisie ou lue
 * (« 3 rue X, 34150 Gignac », « 3 rue X 34150 GIGNAC », « Gignac »…).
 */
export function communeDepuisAdresse(adresse: string): { commune: string | null; codePostal: string | null } {
  const parties = adresse
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^(france|fr)$/i.test(x));
  // Code postal suivi de la commune, n'importe où dans l'adresse (le dernier gagne).
  const avecCp = [...adresse.matchAll(/\b(\d{5})\s+([A-Za-zÀ-ÿ'’][A-Za-zÀ-ÿ'’ .-]*?)(?=\s*(?:,|\n|$|\bcedex\b|\bfrance\b))/gi)].pop();
  if (avecCp) {
    const commune = avecCp[2]!.replace(/\s+\([^)]*\)$/, "").trim();
    if (commune.length >= 2 && commune.length <= 80) return { commune, codePostal: avecCp[1]! };
  }
  const cp = /\b(\d{5})\b/.exec(adresse)?.[1] ?? null;
  const derniere = parties[parties.length - 1];
  if (parties.length >= 2 && derniere && derniere.length >= 2 && derniere.length <= 80 && !/^\d/.test(derniere)) return { commune: derniere, codePostal: cp };
  return { commune: null, codePostal: cp };
}

const pointDe = (v: VillageRef): Point | null => {
  if (v.lat === null || v.lat === undefined || v.lng === null || v.lng === undefined || v.lat === "" || v.lng === "") return null;
  const p = { lat: Number(v.lat), lng: Number(v.lng) };
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
};

export type RaisonRangement = "commune" | "proximite" | "hors_tournee";

/**
 * Village d'une adresse parmi ceux de la tournée ; null = hors tournée.
 * `commune` / `codePostal` : ceux du géocodage s'ils sont connus, sinon lus dans l'adresse.
 */
export function villagePourAdresse(
  adresse: { commune?: string | null; codePostal?: string | null; point?: Point | null },
  villages: VillageRef[],
): { village: VillageRef | null; raison: RaisonRangement; distanceKm?: number } {
  if (!villages.length) return { village: null, raison: "hors_tournee" };
  const cle = adresse.commune ? cleCommune(adresse.commune) : null;
  if (cle) {
    const memeNom = villages.filter((v) => cleCommune(v.name) === cle);
    // Deux villages homonymes : le code postal départage.
    const choisi = memeNom.find((v) => !adresse.codePostal || !v.postal_code || v.postal_code === adresse.codePostal) ?? null;
    if (choisi) return { village: choisi, raison: "commune" };
  }
  if (adresse.point) {
    let meilleur: { v: VillageRef; d: number } | null = null;
    for (const v of villages) {
      const p = pointDe(v);
      if (!p) continue;
      const d = distanceKm(adresse.point, p);
      if (!meilleur || d < meilleur.d) meilleur = { v, d };
    }
    const rayon = cle ? RAYON_COMMUNE_DIFFERENTE_KM : RAYON_VILLAGE_KM;
    if (meilleur && meilleur.d <= rayon) return { village: meilleur.v, raison: "proximite", distanceKm: Math.round(meilleur.d * 10) / 10 };
  }
  return { village: null, raison: "hors_tournee" };
}
