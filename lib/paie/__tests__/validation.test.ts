import { describe, expect, it } from "vitest";
import { deciderValidation, effets, lisiblePar, peutGenerer, peutValider, statutApresGeneration, statutValide } from "@/lib/paie/validation";

describe("validation des bulletins (Q1 révisée)", () => {
  it("le comptable génère, seule la direction valide", () => {
    expect(peutGenerer("comptable")).toBe(true);
    expect(peutGenerer("direction")).toBe(true);
    expect(peutGenerer("manager")).toBe(false);
    expect(peutValider("comptable")).toBe(false);
    expect(peutValider("direction")).toBe(true);
  });

  it("tout bulletin généré ou régénéré naît en attente", () => {
    expect(statutApresGeneration()).toBe("en_attente");
  });

  it("un non-direction ne peut ni valider ni refuser", () => {
    for (const role of ["comptable", "manager", "chauffeur", "manager_chauffeur"] as const) {
      expect(deciderValidation({ role, decision: "valider", statutActuel: "en_attente" }).ok).toBe(false);
      expect(deciderValidation({ role, decision: "refuser", commentaire: "x", statutActuel: "en_attente" }).ok).toBe(false);
    }
  });

  it("la direction valide ; un refus exige un commentaire", () => {
    expect(deciderValidation({ role: "direction", decision: "valider", statutActuel: "en_attente" })).toEqual({ ok: true, statut: "valide" });
    expect(deciderValidation({ role: "direction", decision: "refuser", statutActuel: "en_attente" }).ok).toBe(false);
    expect(deciderValidation({ role: "direction", decision: "refuser", commentaire: "  ", statutActuel: "en_attente" }).ok).toBe(false);
    expect(deciderValidation({ role: "direction", decision: "refuser", commentaire: "Prime oubliée", statutActuel: "en_attente" })).toEqual({ ok: true, statut: "refuse" });
    expect(deciderValidation({ role: "direction", decision: "valider", statutActuel: "refuse" }).ok).toBe(true);
    expect(deciderValidation({ role: "direction", decision: "valider", statutActuel: "valide" }).ok).toBe(false);
  });

  it("aucun effet tant que ce n'est pas validé", () => {
    for (const s of ["en_attente", "refuse", null] as const) {
      expect(Object.values(effets(s)).every((v) => v === false)).toBe(true);
    }
    expect(Object.values(effets("valide")).every((v) => v === true)).toBe(true);
  });

  it("le salarié ne lit que ses bulletins validés ; direction et comptable lisent tout", () => {
    const b = (validation_status: "en_attente" | "valide" | "refuse", user_id = "u1") => ({ user_id, validation_status });
    expect(lisiblePar({ role: "chauffeur", userId: "u1", bulletin: b("en_attente") })).toBe(false);
    expect(lisiblePar({ role: "chauffeur", userId: "u1", bulletin: b("refuse") })).toBe(false);
    expect(lisiblePar({ role: "chauffeur", userId: "u1", bulletin: b("valide") })).toBe(true);
    expect(lisiblePar({ role: "chauffeur", userId: "u2", bulletin: b("valide") })).toBe(false);
    expect(lisiblePar({ role: "comptable", userId: "x", bulletin: b("en_attente") })).toBe(true);
    expect(lisiblePar({ role: "direction", userId: "x", bulletin: b("refuse") })).toBe(true);
  });

  it("statut inconnu traité comme en attente", () => {
    expect(statutValide("valide")).toBe("valide");
    expect(statutValide(undefined)).toBe("en_attente");
    expect(statutValide("n'importe quoi")).toBe("en_attente");
  });
});
