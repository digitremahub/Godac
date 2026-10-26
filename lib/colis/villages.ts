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
 *   3. sinon, liste « Hors tournée » de sa commune (une par commune,
 *      signalée hors tournée) ; sans commune lisible, liste « Hors tournée ».
 *
 * Purement fonctionnel (testé dans lib/colis/__tests__/villages.test.ts).
 */
import { distanceKm, type Point } from "@/lib/colis/optimisation";

export const LISTE_HORS_TOURNEE = "Hors tournée";
/** Liste où sont mises de côté (sans suppression) les adresses des villages décochés au lancement. */
export const LISTE_REPORTES = "Reportés";

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

const PARTICULES = new Set(["de", "du", "des", "la", "le", "les", "sur", "sous", "en", "d", "l", "et", "aux", "au"]);

/** Commune lue sur une adresse, à afficher : « GIGNAC » → « Gignac », « st jean de fos » → « St Jean de Fos ». */
export function nomCommuneLisible(commune: string): string {
  return commune
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr-FR")
    .replace(/[\p{L}\p{N}]+/gu, (mot, index: number) => (index > 0 && PARTICULES.has(mot) ? mot : mot.charAt(0).toLocaleUpperCase("fr-FR") + mot.slice(1)));
}

/** Liste « Reportés » (repérée par son nom : aucune colonne dédiée n'est nécessaire). */
export const estListeReportee = (l: { name: string }) => cleCommune(l.name) === cleCommune(LISTE_REPORTES);

/** Liste hors tournée : drapeau de la liste, à défaut (avant la migration 190) son nom. */
export const estListeHorsTournee = (l: { name: string; is_hors_tournee?: boolean | null }) => l.is_hors_tournee === true || cleCommune(l.name) === cleCommune(LISTE_HORS_TOURNEE);

export type RangementAdresse =
  | { type: "village"; village: VillageRef; raison: "commune" | "proximite" }
  /** Commune lue sur l'adresse, qui n'est pas un village de la tournée. */
  | { type: "commune"; nom: string; cle: string }
  /** Ni village ni commune lisible : liste « Hors tournée ». */
  | { type: "hors_tournee" };

/**
 * Où ranger une adresse : village de la tournée, sinon sa commune (liste
 * hors tournée, une par commune), sinon « Hors tournée ». `commune` : celle
 * du géocodage ou, à défaut, celle lue dans le texte de l'adresse.
 */
export function rangerAdresse(
  adresse: { texte?: string | null; commune?: string | null; codePostal?: string | null; point?: Point | null },
  villages: VillageRef[],
): RangementAdresse {
  const lu = adresse.texte ? communeDepuisAdresse(adresse.texte) : { commune: null, codePostal: null };
  const commune = adresse.commune || lu.commune;
  const codePostal = adresse.codePostal || lu.codePostal;
  const r = villagePourAdresse({ commune, codePostal, point: adresse.point ?? null }, villages);
  if (r.village) return { type: "village", village: r.village, raison: r.raison === "proximite" ? "proximite" : "commune" };
  const cle = commune ? cleCommune(commune) : "";
  return cle ? { type: "commune", nom: nomCommuneLisible(commune!).slice(0, 60), cle } : { type: "hors_tournee" };
}

/** Élément cochable au lancement : un village de la tournée ou une commune / liste hors tournée. */
export interface ElementLancement {
  /** Identifiant d'un village, « liste:<id> » (autre liste) ou « commune:<clé> » (adresses reportées). */
  id: string;
  nom: string;
  village: boolean;
  horsTournee: boolean;
  arrets: number;
  colis: number;
  /** Mis de côté lors d'un lancement précédent (donc décoché par défaut). */
  reporte: boolean;
}

/**
 * Élément (case à cocher) d'un arrêt déjà reporté : le village de la tournée
 * dont il porte le nom de commune, sinon la commune lue sur l'adresse.
 */
export function elementDeReporte(adresse: string, villages: { id: string; nom: string }[]): { id: string; nom: string; village: boolean } {
  const { commune } = communeDepuisAdresse(adresse);
  const cle = commune ? cleCommune(commune) : "";
  const village = cle ? villages.find((v) => cleCommune(v.nom) === cle) : undefined;
  if (village) return { id: village.id, nom: village.nom, village: true };
  return { id: `commune:${cle}`, nom: commune ? nomCommuneLisible(commune) : LISTE_HORS_TOURNEE, village: false };
}

/**
 * Éléments à cocher au lancement, dans l'ordre d'affichage : villages de la
 * tournée, puis autres listes (hors tournée par commune, liste principale…),
 * puis les adresses déjà reportées par commune. Les listes sans arrêt ne
 * sont pas proposées (hors villages de la tournée).
 */
export function elementsLancement(p: {
  villages: { id: string; nom: string }[];
  listes: { id: string; name: string; hors_tournee: boolean; reportee: boolean; village_id: string | null }[];
  arrets: { list_id: string | null; parcel_count: number; address: string }[];
}): ElementLancement[] {
  const total = (a: { parcel_count: number }[]) => ({ arrets: a.length, colis: a.reduce((n, s) => n + (s.parcel_count ?? 0), 0) });
  const reportees = new Set(p.listes.filter((l) => l.reportee).map((l) => l.id));
  const dejaReportes = p.arrets.filter((s) => s.list_id && reportees.has(s.list_id));
  const reportParElement = new Map<string, { nom: string; village: boolean; arrets: typeof dejaReportes }>();
  for (const s of dejaReportes) {
    const e = elementDeReporte(s.address, p.villages);
    const g = reportParElement.get(e.id) ?? { nom: e.nom, village: e.village, arrets: [] };
    g.arrets.push(s);
    reportParElement.set(e.id, g);
  }

  const villages = p.villages.map((v): ElementLancement => {
    const listeIds = new Set(p.listes.filter((l) => l.village_id === v.id).map((l) => l.id));
    const ici = total(p.arrets.filter((s) => s.list_id && listeIds.has(s.list_id)));
    const reporte = total(reportParElement.get(v.id)?.arrets ?? []);
    return { id: v.id, nom: v.nom, village: true, horsTournee: false, arrets: ici.arrets + reporte.arrets, colis: ici.colis + reporte.colis, reporte: ici.arrets === 0 && reporte.arrets > 0 };
  });
  const idsVillage = new Set(p.villages.map((v) => v.id));
  const autres: ElementLancement[] = [];
  const principale = total(p.arrets.filter((s) => s.list_id === null));
  if (principale.arrets > 0) autres.push({ id: "liste:__principale__", nom: "Liste principale", village: false, horsTournee: false, ...principale, reporte: false });
  for (const l of p.listes) {
    if (l.reportee || (l.village_id && idsVillage.has(l.village_id))) continue;
    const c = total(p.arrets.filter((s) => s.list_id === l.id));
    if (c.arrets > 0) autres.push({ id: `liste:${l.id}`, nom: l.name, village: false, horsTournee: l.hors_tournee, ...c, reporte: false });
  }
  const communes = [...reportParElement.entries()]
    .filter(([id]) => !idsVillage.has(id))
    .map(([id, g]): ElementLancement => ({ id, nom: g.nom, village: false, horsTournee: true, ...total(g.arrets), reporte: true }));
  return [...villages, ...autres, ...communes];
}

/** Élément (case) d'un arrêt et s'il est actuellement mis de côté dans « Reportés ». */
export function elementDeArret(
  arret: { list_id: string | null; address: string },
  listes: { id: string; name: string; village_id: string | null }[],
  villages: { id: string; nom: string }[],
): { id: string; reporte: boolean } {
  const liste = arret.list_id ? listes.find((l) => l.id === arret.list_id) : undefined;
  if (liste && estListeReportee(liste)) return { id: elementDeReporte(arret.address, villages).id, reporte: true };
  if (liste?.village_id && villages.some((v) => v.id === liste.village_id)) return { id: liste.village_id, reporte: false };
  return { id: `liste:${liste?.id ?? "__principale__"}`, reporte: false };
}

/** Cases cochées par défaut : tout, sauf ce qui avait déjà été reporté. */
export const cochesParDefaut = (elements: ElementLancement[]): string[] => elements.filter((e) => !e.reporte).map((e) => e.id);

/** Tout cocher / tout décocher. */
export const basculerTout = (elements: ElementLancement[], coches: string[]): string[] => (elements.length > 0 && elements.every((e) => coches.includes(e.id)) ? [] : elements.map((e) => e.id));

/**
 * Sélection au lancement : identifiants inconnus ignorés ; il faut au moins
 * un élément coché pour démarrer. `gardes` = desservis, `reportes` = mis de côté (jamais supprimés).
 */
export function selectionLancement(elements: ElementLancement[], coches: string[]): { ok: true; gardes: ElementLancement[]; reportes: ElementLancement[] } | { ok: false; erreur: string } {
  const choisis = new Set(coches);
  const gardes = elements.filter((e) => choisis.has(e.id));
  if (elements.length > 0 && gardes.length === 0) return { ok: false, erreur: "Cochez au moins un village pour démarrer la tournée." };
  return { ok: true, gardes, reportes: elements.filter((e) => !choisis.has(e.id)) };
}

/**
 * Arrêts à mettre de côté : ceux des éléments décochés qui ne sont pas déjà
 * dans « Reportés » ; à reprendre : ceux de « Reportés » dont l'élément est coché.
 * `elementDe` : élément d'un arrêt (null = ignoré).
 */
export function partageReports<T extends { id: string }>(arrets: T[], elementDe: (a: T) => { id: string; reporte: boolean } | null, gardes: Set<string>): { aReporter: T[]; aReprendre: T[] } {
  const aReporter: T[] = [];
  const aReprendre: T[] = [];
  for (const a of arrets) {
    const e = elementDe(a);
    if (!e) continue;
    if (!gardes.has(e.id) && !e.reporte) aReporter.push(a);
    else if (gardes.has(e.id) && e.reporte) aReprendre.push(a);
  }
  return { aReporter, aReprendre };
}

/**
 * Arrêts de la tournée en cours (« actifs ») et arrêts mis de côté dans
 * « Reportés » ; la liste « Reportés » elle-même n'est pas affichée.
 */
export function separerReportes<T extends { list_id?: string | null }, L extends { id: string; name: string }>(arrets: T[], listes: L[]): { actifs: T[]; reportes: T[]; listes: L[] } {
  const ids = new Set(listes.filter(estListeReportee).map((l) => l.id));
  if (!ids.size) return { actifs: arrets, reportes: [], listes };
  return { actifs: arrets.filter((s) => !(s.list_id && ids.has(s.list_id))), reportes: arrets.filter((s) => s.list_id && ids.has(s.list_id)), listes: listes.filter((l) => !ids.has(l.id)) };
}
