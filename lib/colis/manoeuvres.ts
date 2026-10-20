// GO Navigation : indications de direction (manœuvres OSRM, `steps=true`).
// Fonctions pures, testées dans lib/colis/__tests__/manoeuvres.test.ts :
//  - liste compacte des manœuvres tirée de la réponse OSRM ;
//  - textes en français (« Tournez à droite sur rue X », « Au rond-point,
//    prenez la 2e sortie »…) et pictogramme à afficher ;
//  - placement des manœuvres le long du tracé et choix de la manœuvre
//    courante selon la distance parcourue ;
//  - format des distances (« 300 m », « 1,2 km ») et annonces vocales.

import type { Manoeuvre } from "@/lib/colis/itineraire";
import { longueursCumulees, projeterSurTrace } from "@/lib/colis/navigation";

export type { Manoeuvre };

/** Étape OSRM (sous-ensemble utile). */
export interface EtapeOsrm {
  distance: number;
  name?: string;
  ref?: string;
  rotary_name?: string;
  maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number };
}

/**
 * Manœuvres compactes d'une réponse OSRM (`routes[0].legs`). Les arrivées
 * intermédiaires (entre deux tronçons) sont retirées : seule la dernière
 * reste. Liste vide si les étapes manquent.
 */
export function manoeuvresOsrm(legs: readonly { steps?: readonly EtapeOsrm[] }[] | null | undefined): Manoeuvre[] {
  const res: Manoeuvre[] = [];
  (legs ?? []).forEach((leg, i, tous) => {
    for (const st of leg.steps ?? []) {
      const m = st?.maneuver;
      if (!m || !Array.isArray(m.location) || m.location.length < 2) continue;
      if (m.type === "arrive" && i < tous.length - 1) continue;
      if (m.type === "depart" && i > 0) continue;
      const rue = (st.name?.trim() || st.ref?.trim() || "").slice(0, 80);
      res.push({
        type: m.type,
        ...(m.modifier ? { modifier: m.modifier } : {}),
        rue,
        ...(typeof m.exit === "number" && m.exit > 0 ? { sortie: m.exit } : {}),
        distanceM: Math.round(Number(st.distance) || 0),
        lieu: [Number(m.location[0]), Number(m.location[1])],
      });
    }
  });
  return res;
}

const COTE: Record<string, string> = {
  right: "à droite",
  left: "à gauche",
  "slight right": "légèrement à droite",
  "slight left": "légèrement à gauche",
  "sharp right": "franchement à droite",
  "sharp left": "franchement à gauche",
};

const estRondPoint = (t: string) => t === "roundabout" || t === "rotary";
const sur = (rue: string) => (rue ? ` sur ${rue}` : "");

/** « 1re », « 2e », « 3e »… */
export function ordinal(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

/** Texte de la manœuvre, en français. */
export function texteManoeuvre(m: Pick<Manoeuvre, "type" | "modifier" | "rue" | "sortie">): string {
  const cote = m.modifier ? COTE[m.modifier] : undefined;
  if (m.type === "arrive") return "Vous êtes arrivé";
  if (m.type === "depart") return `Partez${sur(m.rue)}`;
  if (estRondPoint(m.type)) return m.sortie ? `Au rond-point, prenez la ${ordinal(m.sortie)} sortie${sur(m.rue)}` : `Prenez le rond-point${sur(m.rue)}`;
  if (m.type === "exit roundabout" || m.type === "exit rotary") return `Sortez du rond-point${sur(m.rue)}`;
  if (m.modifier === "uturn") return `Faites demi-tour${sur(m.rue)}`;
  if (m.type === "roundabout turn") return cote ? `Au rond-point, tournez ${cote}${sur(m.rue)}` : `Traversez le rond-point${sur(m.rue)}`;
  if (m.type === "fork") return cote ? `À l'embranchement, restez ${cote.replace("légèrement ", "").replace("franchement ", "")}${sur(m.rue)}` : `À l'embranchement, continuez${sur(m.rue)}`;
  if (m.type === "merge") return `Insérez-vous${cote ? ` ${cote.replace("légèrement ", "")}` : ""}${sur(m.rue)}`;
  if (m.type === "on ramp") return `Prenez la bretelle${cote ? ` ${cote.replace("légèrement ", "").replace("franchement ", "")}` : ""}${sur(m.rue)}`;
  if (m.type === "off ramp") return `Prenez la sortie${cote ? ` ${cote.replace("légèrement ", "").replace("franchement ", "")}` : ""}${sur(m.rue)}`;
  if (!cote) return m.rue && m.type !== "continue" ? `Continuez sur ${m.rue}` : `Continuez tout droit${sur(m.rue)}`;
  if (m.type === "new name" || m.type === "continue") return `Continuez ${cote}${sur(m.rue)}`;
  // turn, end of road, notification…
  return `Tournez ${cote}${sur(m.rue)}`;
}

export type Pictogramme =
  | "tout-droit"
  | "gauche"
  | "droite"
  | "legere-gauche"
  | "legere-droite"
  | "serree-gauche"
  | "serree-droite"
  | "demi-tour"
  | "rond-point"
  | "arrivee";

/** Pictogramme (flèche) de la manœuvre. */
export function pictogramme(m: Pick<Manoeuvre, "type" | "modifier">): Pictogramme {
  if (m.type === "arrive") return "arrivee";
  if (estRondPoint(m.type)) return "rond-point";
  switch (m.modifier) {
    case "uturn":
      return "demi-tour";
    case "left":
      return "gauche";
    case "right":
      return "droite";
    case "slight left":
      return "legere-gauche";
    case "slight right":
      return "legere-droite";
    case "sharp left":
      return "serree-gauche";
    case "sharp right":
      return "serree-droite";
    default:
      return "tout-droit";
  }
}

/** Distance avant la manœuvre : « 30 m », « 300 m », « 1,2 km », « 12 km ». */
export function formatDistanceManoeuvre(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres) || metres < 0) return "—";
  if (metres < 100) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  if (metres < 975) return `${Math.round(metres / 50) * 50} m`;
  const km = metres / 1000;
  if (km < 9.95) return `${km.toFixed(1).replace(/\.0$/, "").replace(".", ",")} km`;
  return `${Math.round(km)} km`;
}

/** Distance dite à voix haute : « 300 mètres », « 1,5 kilomètre ». */
export function distanceParlee(metres: number): string {
  const ecrit = formatDistanceManoeuvre(metres);
  if (ecrit.endsWith(" km")) {
    const n = ecrit.slice(0, -3);
    return `${n} ${Number(n.replace(",", ".")) < 2 ? "kilomètre" : "kilomètres"}`;
  }
  return ecrit.replace(/ m$/, " mètres");
}

export interface ManoeuvrePlacee extends Manoeuvre {
  /** Distance (m) le long du tracé, depuis son début, jusqu'au point de manœuvre. */
  abscisseM: number;
}

/**
 * Place les manœuvres le long du tracé (projection de leur point, dans
 * l'ordre : un tracé qui repasse au même endroit ne les mélange pas).
 */
export function placerManoeuvres(ligne: readonly [number, number][], manoeuvres: readonly Manoeuvre[]): ManoeuvrePlacee[] {
  if (ligne.length < 2) return [];
  const cumul = longueursCumulees(ligne);
  let segment = 1;
  let abscisse = 0;
  return manoeuvres.map((m) => {
    const proj = projeterSurTrace({ lng: m.lieu[0], lat: m.lieu[1] }, ligne, cumul, segment);
    if (proj) {
      segment = proj.segment;
      abscisse = Math.max(abscisse, proj.abscisseM);
    }
    return { ...m, abscisseM: abscisse };
  });
}

/** Marge (m) au-delà du point de manœuvre avant de passer à la suivante. */
export const MARGE_DEPASSEMENT_M = 12;

/**
 * Manœuvre à annoncer selon la distance parcourue le long du tracé : la
 * première (hors départ) dont le point n'est pas encore dépassé. Une fois
 * toutes dépassées, la dernière (arrivée) avec une distance nulle.
 */
export function manoeuvreCourante(placees: readonly ManoeuvrePlacee[], parcouruM: number, marge = MARGE_DEPASSEMENT_M): { index: number; distanceM: number } | null {
  if (placees.length === 0 || !Number.isFinite(parcouruM)) return null;
  const debut = placees[0]!.type === "depart" && placees.length > 1 ? 1 : 0;
  for (let i = debut; i < placees.length; i++) {
    const m = placees[i]!;
    if (parcouruM < m.abscisseM + marge) return { index: i, distanceM: Math.max(0, m.abscisseM - parcouruM) };
  }
  return { index: placees.length - 1, distanceM: 0 };
}

export type Palier = "500" | "150" | "point";

/** Palier d'annonce vocale selon la distance avant la manœuvre : ~500 m, ~150 m, au point (< 30 m). */
export function palierAnnonce(distanceM: number): Palier | null {
  if (!Number.isFinite(distanceM) || distanceM < 0) return null;
  if (distanceM <= 30) return "point";
  if (distanceM <= 150) return "150";
  if (distanceM <= 500) return "500";
  return null;
}

/** Phrase de l'annonce vocale. */
export function phraseAnnonce(m: Pick<Manoeuvre, "type" | "modifier" | "rue" | "sortie">, palier: Palier, distanceM: number): string {
  if (m.type === "arrive") return palier === "point" ? "Vous êtes arrivé" : `Dans ${distanceParlee(distanceM)}, vous arrivez à destination`;
  const texte = texteManoeuvre(m);
  if (palier === "point") return texte;
  return `Dans ${distanceParlee(distanceM)}, ${texte.charAt(0).toLocaleLowerCase("fr-FR")}${texte.slice(1)}`;
}
