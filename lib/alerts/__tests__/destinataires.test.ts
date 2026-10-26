import { describe, expect, it } from "vitest";
import { choisirDestinataires, estLimiteAuService, rolesCibles } from "@/lib/alerts/destinataires";

const gens = [
  { id: "m1", role: "manager" },
  { id: "m2", role: "manager" },
  { id: "e1", role: "exploitation" },
  { id: "d1", role: "direction" },
  { id: "c1", role: "comptable" },
];
const services = new Map([
  ["m1", ["A"]],
  ["m2", ["B"]],
]);

describe("destinataires d'une alerte (e-mail, push)", () => {
  it("alerte d'un service : seul le manager de ce service, exploitation et direction partout", () => {
    expect(choisirDestinataires(gens, { service_id: "A" }, services).map((g) => g.id)).toEqual(["m1", "e1", "d1", "c1"]);
    expect(choisirDestinataires(gens, { service_id: "B" }, services).map((g) => g.id)).toEqual(["m2", "e1", "d1", "c1"]);
  });
  it("alerte sans service : tous les managers", () => {
    expect(choisirDestinataires(gens, { service_id: null }, services)).toHaveLength(5);
    expect(choisirDestinataires(gens, {}, services)).toHaveLength(5);
  });
  it("manager sans service connu : pas d'alerte de service", () => {
    expect(choisirDestinataires([{ id: "m3", role: "manager" }], { service_id: "A" }, services)).toEqual([]);
  });
  it("seuls les managers sont limités au service", () => {
    expect(estLimiteAuService("manager", "A")).toBe(true);
    expect(estLimiteAuService("exploitation", "A")).toBe(false);
    expect(estLimiteAuService("direction", "A")).toBe(false);
    expect(estLimiteAuService("manager", null)).toBe(false);
  });
  it("rôles ciblés : l'exploitation suit les managers, défaut direction et exploitation", () => {
    expect(rolesCibles(["manager"]).sort()).toEqual(["exploitation", "manager"]);
    expect(rolesCibles([]).sort()).toEqual(["direction", "exploitation"]);
  });
});
