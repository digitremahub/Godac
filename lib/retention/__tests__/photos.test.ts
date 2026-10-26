import { describe, expect, it } from "vitest";
import { cheminsPhotos, enLots } from "@/lib/retention/photos";

describe("photos de preuve à purger", () => {
  it("reprend toutes les photos : liste complète et chemin simple, sans doublon", () => {
    expect(
      cheminsPhotos([
        { proof_photo_path: "a/1.jpg", proof_photo_paths: ["a/1.jpg", "a/2.jpg", "a/3.jpg"] },
        { proof_photo_path: "b/1.jpg", proof_photo_paths: [] },
        { proof_photo_path: null, proof_photo_paths: ["c/1.jpg"] },
        { proof_photo_path: "d/1.jpg" },
      ]),
    ).toEqual(["a/1.jpg", "a/2.jpg", "a/3.jpg", "b/1.jpg", "c/1.jpg", "d/1.jpg"]);
  });
  it("ignore les valeurs vides", () => {
    expect(cheminsPhotos([{ proof_photo_path: "", proof_photo_paths: null }, { proof_photo_path: "  " }])).toEqual([]);
  });
  it("découpe en lots", () => {
    expect(enLots([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(enLots([], 2)).toEqual([]);
  });
});
