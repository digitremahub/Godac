import { describe, expect, it } from "vitest";
import { estConducteur, FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";

describe("conducteurs (chauffeur ou manager qui conduit)", () => {
  it("chauffeur toujours, manager seulement avec can_drive", () => {
    expect(estConducteur("chauffeur", false)).toBe(true);
    expect(estConducteur("manager", false)).toBe(false);
    expect(estConducteur("manager", true)).toBe(true);
    expect(estConducteur("direction", true)).toBe(false);
    expect(estConducteur("comptable", true)).toBe(false);
  });
  it("filtre PostgREST", () => {
    expect(FILTRE_CONDUCTEURS).toBe("role.eq.chauffeur,and(role.eq.manager,can_drive.is.true)");
  });
});
