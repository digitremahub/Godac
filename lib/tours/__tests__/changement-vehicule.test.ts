import { describe, expect, it } from "vitest";
import { PHOTOS_CHANGEMENT, photosManquantes } from "@/lib/tours/changement-vehicule";

describe("photos de changement de véhicule", () => {
  it("toutes exigées pour un changement", () => {
    expect(photosManquantes("changement", [])).toHaveLength(6);
    expect(photosManquantes(undefined, [{ kind: "habitacle" }, { kind: "avant" }])).toEqual(["tableau_de_bord", "arriere", "cote_gauche", "cote_droit"]);
  });
  it("complètes", () => {
    expect(photosManquantes("changement", PHOTOS_CHANGEMENT.map((p) => ({ kind: p.kind })))).toEqual([]);
  });
  it("aucune pour un dépannage", () => {
    expect(photosManquantes("depannage", [])).toEqual([]);
  });
});
