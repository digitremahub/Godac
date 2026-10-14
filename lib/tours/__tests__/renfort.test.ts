import { describe, expect, it } from "vitest";
import { coverageForEntries, renfortByVillage, renfortCandidates, renfortLabel, sanitizeRenfortVillageIds, type RenfortRoute } from "@/lib/tours/renfort";

const route = (id: string, serviceId: string | null, villages: string[], isRenfort = false): RenfortRoute => ({
  id,
  tourNumber: id.toUpperCase(),
  serviceId,
  isRenfort,
  villages: villages.map((v) => ({ id: v })),
});

describe("tournées empruntables par un renfort", () => {
  const routes = [route("t1", "s1", ["a", "b"]), route("t2", "s1", ["c"]), route("t3", "s2", ["d"]), route("t4", null, ["e"]), route("r9", "s1", [], true), route("r8", "s1", [], true)];
  it("les tournées fixes du même service et celles « tous services », jamais un autre renfort", () => {
    expect(renfortCandidates(routes, { id: "r9", serviceId: "s1" }).map((r) => r.id)).toEqual(["t1", "t2", "t4"]);
  });
  it("un renfort sans service peut emprunter partout", () => {
    expect(renfortCandidates(routes, { id: "r9", serviceId: null }).map((r) => r.id)).toEqual(["t1", "t2", "t3", "t4"]);
  });
  it("ne garde que les villages empruntables, sans doublon", () => {
    const c = renfortCandidates(routes, { id: "r9", serviceId: "s1" });
    expect(sanitizeRenfortVillageIds(["a", "d", "c", "a", "zz"], c)).toEqual(["a", "c"]);
  });
});

describe("couverture du jour", () => {
  const entries = [
    { planningEntryId: "p1", renfortRouteId: "r9", tourNumber: "R9" },
    { planningEntryId: "p2", renfortRouteId: "r9", tourNumber: "R9" },
    { planningEntryId: "p3", renfortRouteId: "r12", tourNumber: "R12" },
  ];
  const defaults = [
    { renfortRouteId: "r9", villageId: "a" },
    { renfortRouteId: "r9", villageId: "c" },
    { renfortRouteId: "r12", villageId: "c" },
  ];
  it("choix du jour prioritaire, sinon couverture par défaut", () => {
    const cov = coverageForEntries(entries, defaults, [{ planningEntryId: "p2", villageId: "b" }]);
    expect(cov.get("p1")).toEqual({ villageIds: ["a", "c"], specific: false });
    expect(cov.get("p2")).toEqual({ villageIds: ["b"], specific: true });
    expect(cov.get("p3")).toEqual({ villageIds: ["c"], specific: false });
  });
  it("chaque village connaît les renforts qui le couvrent ce jour-là", () => {
    const by = renfortByVillage(entries, coverageForEntries(entries, defaults, []));
    expect(by.get("a")).toEqual(["R9"]);
    expect(by.get("c")).toEqual(["R9", "R12"]);
    expect(by.has("b")).toBe(false);
  });
  it("libellé affiché sur la tournée d'origine", () => {
    expect(renfortLabel(["R9"])).toBe("en renfort par la tournée R9");
    expect(renfortLabel(["R9", "R12"])).toBe("en renfort par les tournées R9, R12");
    expect(renfortLabel([])).toBe("");
  });
});
