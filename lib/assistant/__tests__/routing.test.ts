import { describe, expect, it } from "vitest";
import { classifySupportCategory, determineSupportRecipient } from "../routing";

describe("classifySupportCategory", () => {
  it("classifies a pay/HR question", () => {
    expect(classifySupportCategory("Ma fiche de paie de ce mois est fausse")).toBe("rh");
  });

  it("classifies a bug report", () => {
    expect(classifySupportCategory("L'application plante quand je valide un plein")).toBe("bug_godac");
  });

  it("classifies an ordinary work question", () => {
    expect(classifySupportCategory("Comment je fais pour démarrer ma tournée ?")).toBe("travail");
  });
});

describe("determineSupportRecipient", () => {
  it("routes a bug report from direction to GODAC support", () => {
    expect(determineSupportRecipient("direction", "bug_godac")).toBe("support_godac");
  });

  it("routes the same bug report from a manager to their own gestionnaire, not GODAC", () => {
    expect(determineSupportRecipient("manager", "bug_godac")).toBe("gestionnaire");
  });

  it("routes a work question to gestionnaire regardless of role", () => {
    expect(determineSupportRecipient("chauffeur", "travail")).toBe("gestionnaire");
    expect(determineSupportRecipient("direction", "travail")).toBe("gestionnaire");
  });

  it("routes an HR question to gestionnaire", () => {
    expect(determineSupportRecipient("chauffeur", "rh")).toBe("gestionnaire");
  });
});
