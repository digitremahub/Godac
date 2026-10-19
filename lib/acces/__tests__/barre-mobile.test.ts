import { describe, expect, it } from "vitest";
import { boutonsBarreMobile } from "@/lib/acces/barre-mobile";

const tout = new Set(["planning", "route_optimizer", "messenger", "maintenance_requests"]);

describe("barre mobile chauffeur (§ 3.3)", () => {
  it("rôles terrain uniquement", () => {
    expect(boutonsBarreMobile("direction", tout, false)).toEqual([]);
    expect(boutonsBarreMobile("comptable", tout, false)).toEqual([]);
    expect(boutonsBarreMobile("manager_chauffeur", tout, false)).toHaveLength(4);
  });

  it("Tournée / Retour selon la tournée en cours, Plein, Colis, Messages", () => {
    expect(boutonsBarreMobile("chauffeur", tout, false).map((b) => b.href)).toEqual(["/tours/start", "/fuel?new=1", "/livreur", "/messenger"]);
    expect(boutonsBarreMobile("chauffeur", tout, true)[0]).toMatchObject({ href: "/tours/end", libelle: "Retour" });
  });

  it("replis : Planning sans Tournée colis, Signaler sans Messenger", () => {
    const m = new Set(["planning", "maintenance_requests"]);
    expect(boutonsBarreMobile("chauffeur", m, false).map((b) => b.libelle)).toEqual(["Tournée", "Plein", "Planning", "Signaler"]);
    expect(boutonsBarreMobile("chauffeur", new Set(), false).map((b) => b.libelle)).toEqual(["Plein"]);
  });
});
