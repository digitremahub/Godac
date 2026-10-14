import { describe, expect, it } from "vitest";
import { arretsSansTelephone, extraireTelephone, lienTel, normaliserTelephone } from "@/lib/colis/telephone";

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

describe("téléphone selon le pays de l'entreprise", () => {
  it("France par défaut : indicatif 00 accepté, pas de faux numéro dans un SSCC", () => {
    expect(normaliserTelephone("0032 470 12 34 56")).toBe("+32470123456");
    expect(extraireTelephone("SSCC 00340123456789012345")).toBeNull();
  });
  it("numéros nationaux convertis avec l'indicatif du pays", () => {
    expect(normaliserTelephone("0470 12 34 56", "BE")).toBe("+32470123456");
    expect(normaliserTelephone("+32 (0)470 12 34 56", "BE")).toBe("+32470123456");
    expect(normaliserTelephone("0151 23456789", "DE")).toBe("+4915123456789");
    expect(normaliserTelephone("612 345 678", "ES")).toBe("+34612345678");
  });
  it("numéro français gardé à l'international hors de France", () => {
    expect(normaliserTelephone("+33 6 12 34 56 78", "BE")).toBe("+33612345678");
  });
  it("extrait un numéro national étranger d'un texte", () => {
    expect(extraireTelephone("DUPONT Marc\nGSM 0470/12.34.56\nRue Neuve 5, 1000 Bruxelles", "BE")).toBe("+32470123456");
  });
  it("arrêts à faire sans téléphone", () => {
    const stops = [
      { phone: null, status: "pending" },
      { phone: "06 12 34 56 78", status: "pending" },
      { phone: null, status: "delivered" },
    ];
    expect(arretsSansTelephone(stops)).toEqual([stops[0]]);
  });
});
