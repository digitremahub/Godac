import { describe, expect, it } from "vitest";
import { extraireTelephone, lienTel, normaliserTelephone } from "@/lib/colis/telephone";

describe("téléphone destinataire", () => {
  it("reconnaît les formats français", () => {
    expect(normaliserTelephone("0612345678")).toBe("06 12 34 56 78");
    expect(normaliserTelephone("+33 6 12 34 56 78")).toBe("06 12 34 56 78");
    expect(normaliserTelephone("+33 (0)4.78.12.34.56")).toBe("04 78 12 34 56");
    expect(normaliserTelephone("0033612345678")).toBe("06 12 34 56 78");
  });
  it("garde les numéros étrangers avec indicatif", () => {
    expect(normaliserTelephone("+32 470 12 34 56")).toBe("+32470123456");
  });
  it("refuse ce qui n'est pas un numéro", () => {
    expect(normaliserTelephone("12345")).toBeNull();
    expect(normaliserTelephone("")).toBeNull();
  });
  it("extrait le numéro d'un texte d'étiquette", () => {
    expect(extraireTelephone("MARTIN Julie\nTél : 06.12.34.56.78\n12 rue des Lilas")).toBe("06 12 34 56 78");
    expect(extraireTelephone("Colis 09876543210987")).toBeNull();
    expect(extraireTelephone("12 rue des Lilas, 69230 Saint-Genis-Laval")).toBeNull();
  });
  it("lien d'appel", () => {
    expect(lienTel("06 12 34 56 78")).toBe("tel:0612345678");
  });
});
