import { describe, expect, it } from "vitest";
import { estConducteur, FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";

describe("conducteurs (chauffeur, ou manager / exploitation qui conduit)", () => {
  it("chauffeur toujours, manager et exploitation seulement avec can_drive", () => {
    expect(estConducteur("chauffeur", false)).toBe(true);
    expect(estConducteur("manager", false)).toBe(false);
    expect(estConducteur("manager", true)).toBe(true);
    expect(estConducteur("exploitation", false)).toBe(false);
    expect(estConducteur("exploitation", true)).toBe(true);
    expect(estConducteur("exploitation", null)).toBe(false);
    expect(estConducteur("direction", true)).toBe(false);
    expect(estConducteur("comptable", true)).toBe(false);
  });

  it("filtre PostgREST : chauffeur, ou can_drive hors direction / comptable, sans citer la valeur d'enum 'exploitation'", () => {
    expect(FILTRE_CONDUCTEURS).toBe("role.eq.chauffeur,and(can_drive.is.true,role.not.in.(comptable,direction))");
    // Valide avant l'application de la migration 20261027000001.
    expect(FILTRE_CONDUCTEURS).not.toContain("exploitation");
  });

  it("le filtre PostgREST équivaut à estConducteur pour tous les rôles", () => {
    // Interprétation du filtre pour un rôle et un can_drive donnés.
    const filtre = (role: string, canDrive: boolean) => role === "chauffeur" || (canDrive && !["comptable", "direction"].includes(role));
    for (const role of ["chauffeur", "manager", "exploitation", "comptable", "direction"]) {
      for (const canDrive of [false, true]) expect(filtre(role, canDrive), `${role}/${canDrive}`).toBe(estConducteur(role, canDrive));
    }
  });
});
