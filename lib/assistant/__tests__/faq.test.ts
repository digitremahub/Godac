import { describe, expect, it } from "vitest";
import { anonymizeQuestion, faqSourcesForRole } from "@/lib/assistant/faq";

describe("anonymizeQuestion", () => {
  it("removes contact details, plates, long numbers and names", () => {
    const out = anonymizeQuestion("Je suis Jean Dupont chez Transports Martin, mon camion HF-991-XX, appelez le 06 12 34 56 78 ou jean@ex.fr, badge 123456", [
      "Jean Dupont",
      "Transports Martin",
    ]);
    expect(out).not.toMatch(/Jean|Dupont|Martin|HF-991|06 12|jean@|123456/i);
    expect(out).toContain("[immatriculation]");
    expect(out).toContain("[téléphone]");
    expect(out).toContain("[e-mail]");
  });

  it("keeps an ordinary question intact", () => {
    expect(anonymizeQuestion("Comment poser un congé ?")).toBe("Comment poser un congé ?");
  });
});

describe("faqSourcesForRole", () => {
  it("keeps answered entries visible to the role", () => {
    const rows = [
      { question: "A", answer: "x", roles: [] },
      { question: "B", answer: "y", roles: ["direction" as const] },
      { question: "C", answer: "", roles: [] },
    ];
    expect(faqSourcesForRole(rows, "chauffeur").map((s) => s.title)).toEqual(["Question fréquente : A"]);
  });
});
