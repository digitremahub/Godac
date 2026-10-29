import { describe, expect, it } from "vitest";
import { lienAbsolu } from "@/lib/push/lien";

describe("lien des notifications push", () => {
  it("un lien relatif pointe vers godac.app, jamais vers l'hôte de l'abonnement", () => {
    expect(lienAbsolu("/communication/alertes")).toBe("https://godac.app/communication/alertes");
    expect(lienAbsolu("exploitation")).toBe("https://godac.app/exploitation");
  });
  it("lien absent : tableau de bord ; lien absolu : conservé", () => {
    expect(lienAbsolu(undefined)).toBe("https://godac.app/dashboard");
    expect(lienAbsolu("https://godac.app/x")).toBe("https://godac.app/x");
  });
});
