import { describe, expect, it } from "vitest";
import { libelleLieu, photoObligatoire } from "@/lib/colis/livraison";

describe("lieu de livraison", () => {
  it("photo obligatoire seulement pour boîte aux lettres et jardin", () => {
    expect(photoObligatoire("boite_aux_lettres")).toBe(true);
    expect(photoObligatoire("jardin")).toBe(true);
    expect(photoObligatoire("main_propre")).toBe(false);
    expect(photoObligatoire("voisin")).toBe(false);
  });
  it("libellés", () => {
    expect(libelleLieu("jardin")).toBe("Jardin / terrasse");
    expect(libelleLieu(null)).toBeNull();
  });
});
