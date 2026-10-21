import { describe, expect, it } from "vitest";
import {
  CHAMPS_COMPTE_EXPLOITATION,
  dansLePerimetre,
  estEncadrement,
  peutAttribuerRole,
  peutGererCompte,
  rolesAttribuables,
  rolesDestinatairesEffectifs,
  servicesDuPerimetre,
  verifierModificationParExploitation,
  voitToutLOrganisation,
} from "@/lib/roles/perimetre";
import { ROLE_LABELS } from "@/lib/roles/labels";

describe("périmètre par services", () => {
  const mes = ["s1", "s2"];
  it("manager : ses services ; exploitation et direction : aucun filtre", () => {
    expect(servicesDuPerimetre("manager", mes)).toEqual(["s1", "s2"]);
    expect(servicesDuPerimetre("exploitation", mes)).toBeNull();
    expect(servicesDuPerimetre("exploitation", [])).toBeNull();
    expect(servicesDuPerimetre("direction", [])).toBeNull();
    expect(servicesDuPerimetre("chauffeur", mes)).toEqual([]);
    expect(servicesDuPerimetre("comptable", mes)).toEqual([]);
  });
  it("dansLePerimetre : l'exploitation voit tout, même sans service", () => {
    expect(dansLePerimetre("exploitation", [], "s9")).toBe(true);
    expect(dansLePerimetre("exploitation", [], null)).toBe(true);
    expect(dansLePerimetre("manager", mes, "s1")).toBe(true);
    expect(dansLePerimetre("manager", mes, "s9")).toBe(false);
    expect(dansLePerimetre("manager", mes, null)).toBe(false);
  });
  it("encadrement et encadrement de l'organisation", () => {
    expect(["manager", "exploitation", "direction"].every(estEncadrement)).toBe(true);
    expect(estEncadrement("chauffeur") || estEncadrement("comptable")).toBe(false);
    expect(voitToutLOrganisation("exploitation")).toBe(true);
    expect(voitToutLOrganisation("direction")).toBe(true);
    expect(voitToutLOrganisation("manager")).toBe(false);
  });
  it("libellé", () => {
    expect(ROLE_LABELS.exploitation).toBe("Exploitation");
  });
});

describe("attribution des rôles", () => {
  it("la direction attribue tous les rôles", () => {
    expect(rolesAttribuables("direction").sort()).toEqual(["chauffeur", "comptable", "direction", "exploitation", "manager"]);
  });
  it("l'exploitation attribue seulement chauffeur et manager", () => {
    expect(rolesAttribuables("exploitation")).toEqual(["chauffeur", "manager"]);
    for (const r of ["direction", "comptable", "exploitation"]) expect(peutAttribuerRole("exploitation", r)).toBe(false);
  });
  it("manager, comptable, chauffeur n'attribuent aucun rôle", () => {
    for (const a of ["manager", "comptable", "chauffeur"]) expect(rolesAttribuables(a)).toEqual([]);
  });
  it("gestion des comptes : l'exploitation ne touche jamais direction, comptable ni exploitation", () => {
    expect(peutGererCompte("exploitation", "chauffeur")).toBe(true);
    expect(peutGererCompte("exploitation", "manager")).toBe(true);
    for (const c of ["direction", "comptable", "exploitation"]) expect(peutGererCompte("exploitation", c)).toBe(false);
    for (const c of ["direction", "comptable", "exploitation", "manager", "chauffeur"]) expect(peutGererCompte("direction", c)).toBe(true);
    expect(peutGererCompte("manager", "chauffeur")).toBe(false);
  });
  it("modification d'un compte par l'exploitation", () => {
    expect(verifierModificationParExploitation("chauffeur", ["role"], "manager").ok).toBe(true);
    expect(verifierModificationParExploitation("manager", ["can_drive", "services", "active", "reset_pin"]).ok).toBe(true);
    expect(verifierModificationParExploitation("manager", ["role"], "exploitation").ok).toBe(false);
    expect(verifierModificationParExploitation("chauffeur", ["role"], "direction").ok).toBe(false);
    expect(verifierModificationParExploitation("direction", ["active"]).ok).toBe(false);
    expect(verifierModificationParExploitation("exploitation", ["phone"]).ok).toBe(false);
    // Paie et dossier RH : direction seule.
    for (const champ of ["monthly_gross_salary", "contract_type", "matricule", "social_security_number", "hr_notes"]) {
      expect(CHAMPS_COMPTE_EXPLOITATION).not.toContain(champ);
      expect(verifierModificationParExploitation("chauffeur", [champ]).ok).toBe(false);
    }
  });
});

describe("alertes", () => {
  it("l'exploitation reçoit ce qui est destiné aux managers, pas ce qui est réservé à la direction", () => {
    expect(rolesDestinatairesEffectifs(["manager", "direction"])).toContain("exploitation");
    expect(rolesDestinatairesEffectifs(["manager"])).toEqual(["manager", "exploitation"]);
    expect(rolesDestinatairesEffectifs(["direction"])).toEqual(["direction"]);
    expect(rolesDestinatairesEffectifs(["direction", "comptable"])).not.toContain("exploitation");
    expect(rolesDestinatairesEffectifs(["manager", "exploitation", "direction"]).filter((r) => r === "exploitation")).toHaveLength(1);
  });
});
