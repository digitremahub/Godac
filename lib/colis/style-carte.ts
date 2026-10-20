// Style de carte aux couleurs GODAC pour GO Navigation : fond « paper »
// sobre, eau teintée de teal, grands axes en or pâle, libellés en marine.
// On part du style vectoriel gratuit et sans clé déjà utilisé par l'app
// (OpenFreeMap « liberty », schéma OpenMapTiles) et on recolore ses couches
// d'après leur `source-layer` et leur identifiant : aucune tuile propre à
// héberger. Fonctions pures, testées dans lib/colis/__tests__/style-carte.test.ts.

/** Palette de la carte (charte GODAC : marine, teal, orange, gold, paper). */
export const COULEURS_CARTE = {
  marine: "#0A0F1E",
  teal: "#1BE4C1",
  tealEncre: "#0F766E",
  orange: "#FF6B35",
  gold: "#F5C842",
  relais: "#A78BFA",
  paper: "#F6F7FB",
  surface: "#FFFFFF",
  /** Eau : teal très dilué dans le papier. */
  eau: "#CDEFEA",
  eauLigne: "#9FE0D5",
  /** Verdure (parcs, bois) : vert-gris très léger, pour ne pas concurrencer le tracé teal. */
  verdure: "#E6EFEA",
  zoneUrbaine: "#EEF0F5",
  batiment: "#E2E5EE",
  batimentBord: "#D3D8E3",
  route: "#FFFFFF",
  routeBord: "#D7DCE6",
  /** Autoroutes et nationales : or GODAC pâle, bordure or. */
  axe: "#FBE9AE",
  axeBord: "#E9C761",
  chemin: "#D6DBE5",
  rail: "#C4C9D6",
  frontiere: "#AEB6C7",
  texte: "#2A3247",
  texteRoute: "#5A6378",
  texteNumero: "#7A8294",
  halo: "#FFFFFF",
} as const;

/** Sous-ensemble d'une couche de style MapLibre utile ici (évite d'importer maplibre côté serveur et dans les tests). */
export interface CoucheStyle {
  id: string;
  type: string;
  "source-layer"?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  [cle: string]: unknown;
}

export interface StyleCarte {
  version?: number;
  layers: CoucheStyle[];
  sources?: Record<string, unknown>;
  [cle: string]: unknown;
}

/** Couches masquées : points d'intérêt, sommets, aérodromes… le chauffeur ne voit que la route et ses arrêts. */
const MASQUEES = new Set(["poi", "mountain_peak", "aerodrome_label"]);

const C = COULEURS_CARTE;

function couleurLigne(c: CoucheStyle): string | null {
  const sl = c["source-layer"] ?? "";
  const id = c.id.toLowerCase();
  if (sl === "water" || sl === "waterway") return C.eauLigne;
  if (sl === "boundary") return C.frontiere;
  if (sl === "aeroway") return C.batimentBord;
  if (sl === "park" || sl === "landcover") return null;
  if (sl === "transportation" || /road|highway|bridge|tunnel/.test(id)) {
    if (/rail|transit/.test(id)) return C.rail;
    const axe = /motorway|trunk/.test(id);
    if (/casing|outline/.test(id)) return axe ? C.axeBord : C.routeBord;
    if (/path|pedestrian|track|footway|cycle|steps/.test(id)) return C.chemin;
    return axe ? C.axe : C.route;
  }
  if (sl === "building") return C.batimentBord;
  return null;
}

function couleurRemplissage(c: CoucheStyle): string | null {
  const sl = c["source-layer"] ?? "";
  if (sl === "water") return C.eau;
  if (sl === "park") return C.verdure;
  if (sl === "landcover") return /ice|glacier/.test(c.id) ? C.paper : C.verdure;
  if (sl === "landuse") return C.zoneUrbaine;
  if (sl === "building") return C.batiment;
  if (sl === "aeroway") return C.zoneUrbaine;
  if (sl === "transportation") return C.route;
  return null;
}

function couleurTexte(c: CoucheStyle): string {
  const sl = c["source-layer"] ?? "";
  if (sl === "water_name" || sl === "waterway") return C.tealEncre;
  if (sl === "transportation_name") return C.texteRoute;
  if (sl === "housenumber") return C.texteNumero;
  return C.texte;
}

/** Une couche recolorée (copie) ; les largeurs, filtres et zooms restent ceux du style d'origine. */
export function styliserCouche(c: CoucheStyle): CoucheStyle {
  const paint = { ...(c.paint ?? {}) };
  const layout = { ...(c.layout ?? {}) };
  const sl = c["source-layer"] ?? "";
  if (MASQUEES.has(sl)) return { ...c, layout: { ...layout, visibility: "none" } };
  switch (c.type) {
    case "background":
      paint["background-color"] = C.paper;
      delete paint["background-pattern"];
      break;
    case "fill": {
      const couleur = couleurRemplissage(c);
      if (couleur) {
        paint["fill-color"] = couleur;
        delete paint["fill-pattern"];
        if (sl === "building") paint["fill-outline-color"] = C.batimentBord;
        else delete paint["fill-outline-color"];
      }
      break;
    }
    case "fill-extrusion":
      // Bâtiments en relief : couleur unie et discrète.
      paint["fill-extrusion-color"] = C.batiment;
      paint["fill-extrusion-opacity"] = 0.5;
      break;
    case "line": {
      const couleur = couleurLigne(c);
      if (couleur) {
        paint["line-color"] = couleur;
        delete paint["line-pattern"];
      }
      break;
    }
    case "symbol":
      if (layout["text-field"] !== undefined) {
        paint["text-color"] = couleurTexte(c);
        paint["text-halo-color"] = C.halo;
        paint["text-halo-width"] = 1.4;
      }
      break;
    case "raster":
    case "hillshade":
      // Relief ombré ou image : très atténué.
      return { ...c, layout: { ...layout, visibility: "none" } };
  }
  return { ...c, paint, layout };
}

/** Mention obligatoire des données cartographiques (OpenStreetMap). */
export const ATTRIBUTION_OSM = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>';

/**
 * Style complet aux couleurs GODAC (copie, l'original n'est pas modifié).
 * Ajoute l'attribution OpenStreetMap aux sources vectorielles qui n'en
 * déclarent pas.
 */
export function styliserGodac<T extends StyleCarte>(style: T): T {
  const sources = Object.fromEntries(
    Object.entries(style.sources ?? {}).map(([cle, src]) => {
      const s = src as { type?: string; attribution?: string };
      if (s && s.type === "vector" && !/openstreetmap/i.test(s.attribution ?? "")) return [cle, { ...s, attribution: [s.attribution, ATTRIBUTION_OSM].filter(Boolean).join(" ") }];
      return [cle, src];
    }),
  );
  return { ...style, sources, layers: style.layers.map(styliserCouche) };
}
