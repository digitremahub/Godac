import { describe, expect, it } from "vitest";
import { boutonsBarreMobile } from "@/lib/acces/barre-mobile";
import { urlDe } from "@/lib/acces/catalogue";

const tout = new Set(["planning", "route_optimizer", "messenger", "maintenance_requests"]);

describe("barre mobile chauffeur (§ 3.3)", () => {
  it("gestes de tournée pour qui conduit ; encadrement qui ne conduit pas : À traiter, Suivi, Planning, Messages", () => {
    expect(boutonsBarreMobile("comptable", tout, false)).toEqual([]);
    expect(boutonsBarreMobile("manager", tout, false, true)).toHaveLength(4);
    expect(boutonsBarreMobile("manager", tout, false, true)[0]!.libelle).toBe("Départ");
    const direction = boutonsBarreMobile("direction", tout, false);
    expect(direction.map((b) => b.libelle)).toEqual(["À traiter", "Suivi", "Planning", "Messages"]);
    expect(direction[1]!.href).toBe(urlDe("exploitation.suivi"));
    expect(boutonsBarreMobile("exploitation", tout, false).map((b) => b.libelle)).toEqual(["À traiter", "Suivi", "Planning", "Messages"]);
    expect(boutonsBarreMobile("manager", tout, false).map((b) => b.libelle)).toEqual(["À traiter", "Suivi", "Planning", "Messages"]);
  });

  it("encadrement : seulement les écrans qui s'ouvrent (sans module colis, pas de Suivi)", () => {
    expect(boutonsBarreMobile("exploitation", new Set(["planning"]), false).map((b) => b.libelle)).toEqual(["À traiter", "Planning"]);
  });

  it("Départ / Retour selon la tournée en cours, Plein, Colis, Messages", () => {
    expect(boutonsBarreMobile("chauffeur", tout, false).map((b) => b.href)).toEqual([urlDe("moi.tournee_depart"), `${urlDe("carburant.pleins")}?new=1`, "/livreur", urlDe("communication.messenger")]);
    expect(boutonsBarreMobile("chauffeur", tout, true)[0]).toMatchObject({ href: urlDe("moi.tournee_retour"), libelle: "Retour" });
  });

  it("replis : Planning sans Tournée colis, Signaler sans Messenger", () => {
    const m = new Set(["planning", "maintenance_requests"]);
    expect(boutonsBarreMobile("chauffeur", m, false).map((b) => b.libelle)).toEqual(["Départ", "Plein", "Planning", "Signaler"]);
    expect(boutonsBarreMobile("chauffeur", new Set(), false).map((b) => b.libelle)).toEqual(["Plein"]);
  });

  it("« Signaler » ouvre Signaler un problème, même pour un manager qui conduit (pas la liste d'entretien)", () => {
    const m = new Set(["planning", "maintenance_requests"]);
    expect(boutonsBarreMobile("manager", m, false, true).at(-1)).toMatchObject({ libelle: "Signaler", href: urlDe("moi.signaler") });
    expect(boutonsBarreMobile("chauffeur", m, false).at(-1)!.href).toBe(urlDe("moi.signaler"));
  });
});
