import { describe, expect, it } from "vitest";
import { COULEURS_CARTE as C, styliserGodac, type StyleCarte } from "@/lib/colis/style-carte";

const style: StyleCarte = {
  version: 8,
  sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "OpenFreeMap" }, ne: { type: "raster" } },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
    { id: "water", type: "fill", "source-layer": "water", paint: { "fill-color": "#9ec7e9", "fill-pattern": "x" } },
    { id: "park", type: "fill", "source-layer": "park", paint: { "fill-color": "#d8e8c8" } },
    { id: "building", type: "fill", "source-layer": "building", paint: { "fill-color": "#ccc" } },
    { id: "road_motorway_casing", type: "line", "source-layer": "transportation", paint: { "line-color": "#e9ac77", "line-width": 4 } },
    { id: "road_motorway", type: "line", "source-layer": "transportation", paint: { "line-color": "#fc8" } },
    { id: "road_minor", type: "line", "source-layer": "transportation", paint: { "line-color": "#fff" } },
    { id: "road_major_rail", type: "line", "source-layer": "transportation", paint: { "line-color": "#bbb" } },
    { id: "poi_r1", type: "symbol", "source-layer": "poi", layout: { "text-field": "{name}" } },
    { id: "label_city", type: "symbol", "source-layer": "place", layout: { "text-field": "{name}" } },
    { id: "water_name", type: "symbol", "source-layer": "water_name", layout: { "text-field": "{name}" } },
    { id: "natural_earth", type: "raster", source: "ne" },
  ],
};

describe("style de carte GODAC", () => {
  const s = styliserGodac(style);
  const couche = (id: string) => s.layers.find((l) => l.id === id)!;
  it("fond paper, eau teintée teal, verdure discrète", () => {
    expect(couche("background").paint!["background-color"]).toBe(C.paper);
    expect(couche("water").paint!["fill-color"]).toBe(C.eau);
    expect(couche("water").paint!["fill-pattern"]).toBeUndefined();
    expect(couche("park").paint!["fill-color"]).toBe(C.verdure);
  });
  it("grands axes en or pâle, bordure or ; petites routes blanches ; largeurs conservées", () => {
    expect(couche("road_motorway").paint!["line-color"]).toBe(C.axe);
    expect(couche("road_motorway_casing").paint!["line-color"]).toBe(C.axeBord);
    expect(couche("road_motorway_casing").paint!["line-width"]).toBe(4);
    expect(couche("road_minor").paint!["line-color"]).toBe(C.route);
    expect(couche("road_major_rail").paint!["line-color"]).toBe(C.rail);
  });
  it("libellés en marine (eau en teal foncé), points d'intérêt et relief masqués", () => {
    expect(couche("label_city").paint!["text-color"]).toBe(C.texte);
    expect(couche("water_name").paint!["text-color"]).toBe(C.tealEncre);
    expect(couche("poi_r1").layout!.visibility).toBe("none");
    expect(couche("natural_earth").layout!.visibility).toBe("none");
  });
  it("attribution OpenStreetMap ajoutée aux tuiles vectorielles, original intact", () => {
    expect((s.sources!.openmaptiles as { attribution: string }).attribution).toMatch(/OpenStreetMap/);
    expect((style.sources!.openmaptiles as { attribution: string }).attribution).toBe("OpenFreeMap");
    expect(style.layers[0]!.paint!["background-color"]).toBe("#f8f4f0");
  });
});
