import { describe, expect, it } from "vitest";
import { rolesImportRefuses } from "@/lib/organization/roles-import";

describe("rôles d'un import en masse", () => {
  it("la direction peut inviter tous les rôles", () => {
    expect(rolesImportRefuses("direction", [{ role: "direction" }, { role: "chauffeur" }, { role: "comptable" }])).toEqual([]);
  });
  it("l'exploitation ne peut inviter que des chauffeurs et des managers", () => {
    expect(rolesImportRefuses("exploitation", [{ role: "chauffeur" }, { role: "manager" }])).toEqual([]);
    expect(rolesImportRefuses("exploitation", [{ role: "direction" }, { role: "exploitation" }, { role: "direction" }])).toEqual(["direction", "exploitation"]);
  });
  it("un chauffeur, un manager ou un comptable ne peut rien inviter", () => {
    for (const acteur of ["chauffeur", "manager", "comptable"]) expect(rolesImportRefuses(acteur, [{ role: "chauffeur" }])).toEqual(["chauffeur"]);
  });
  it("sans invitation, rien à refuser", () => {
    expect(rolesImportRefuses("chauffeur", [])).toEqual([]);
  });
});
