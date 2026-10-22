import { describe, expect, it } from "vitest";
import { libelleNavigation, lireNavigationPreferee } from "@/lib/colis/navigation-preferee";

describe("navigation préférée du chauffeur", () => {
  it("GO Navigation par défaut", () => {
    expect(lireNavigationPreferee(null)).toBe("go");
    expect(lireNavigationPreferee(undefined)).toBe("go");
    expect(lireNavigationPreferee("autre")).toBe("go");
  });
  it("Waze et Google Maps mémorisés", () => {
    expect(lireNavigationPreferee("waze")).toBe("waze");
    expect(lireNavigationPreferee("gmaps")).toBe("gmaps");
  });
  it("libellés", () => {
    expect(libelleNavigation("go")).toBe("GO Navigation");
    expect(libelleNavigation("gmaps")).toBe("Google Maps");
  });
});
