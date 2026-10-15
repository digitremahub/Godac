import { describe, expect, it } from "vitest";
import { analyserCode } from "@/lib/colis/etiquette";

describe("analyserCode", () => {
  it("numéro de suivi seul", () => {
    expect(analyserCode("01234567890123")).toEqual({ code: "01234567890123", adresse: null, destinataire: null });
  });
  it("adresse multiligne", () => {
    const r = analyserCode("MARTIN Julie\n12 rue des Lilas\n69230 Saint-Genis-Laval\nFR\n09876543210987");
    expect(r.adresse).toBe("12 rue des Lilas, 69230 Saint-Genis-Laval");
    expect(r.destinataire).toBe("MARTIN Julie");
    expect(r.code).toBe("09876543210987");
  });
  it("adresse sur une ligne", () => {
    expect(analyserCode("3 avenue Foch, 69006 Lyon").adresse).toBe("3 avenue Foch, 69006 Lyon");
  });
  it("JSON", () => {
    const r = analyserCode('{"tracking":"ABC123456","name":"SARL Dupont","street":"1 chemin du Moulin","zip":"69510","city":"Soucieu-en-Jarrest"}');
    expect(r).toEqual({ code: "ABC123456", adresse: "1 chemin du Moulin, 69510 Soucieu-en-Jarrest", destinataire: "SARL Dupont" });
  });
  it("QR contenant une URL avec les champs du colis", () => {
    const r = analyserCode("https://example.test/parcel?trackingNumber=ABC123456&recipientName=SARL%20Dupont&street=1%20chemin%20du%20Moulin&postalCode=69510&city=Soucieu-en-Jarrest&weight=850g");
    expect(r.code).toBe("ABC123456");
    expect(r.adresse).toBe("1 chemin du Moulin, 69510 Soucieu-en-Jarrest");
    expect(r.destinataire).toBe("SARL Dupont");
    expect(r.poids).toBe(0.85);
  });
  it("URL de suivi seule : ne prétend pas connaître l'adresse", () => {
    const r = analyserCode("https://tracking.example.test/ABC123456");
    expect(r.adresse).toBeNull();
    expect(r.code).toContain("https://tracking.example.test");
  });
});

describe("analyserCode — téléphone", () => {
  it("lit le téléphone sans le prendre pour un numéro de colis", () => {
    const r = analyserCode("MARTIN Julie\n12 rue des Lilas\n69230 Saint-Genis-Laval\nTél : 06 12 34 56 78\n09876543210987");
    expect(r.telephone).toBe("06 12 34 56 78");
    expect(r.code).toBe("09876543210987");
    expect(r.adresse).toBe("12 rue des Lilas, 69230 Saint-Genis-Laval");
  });
  it("JSON avec téléphone", () => {
    expect(analyserCode('{"address":"3 avenue Foch, 69006 Lyon","phone":"+33612345678"}').telephone).toBe("06 12 34 56 78");
  });
});

describe("analyserCode — poids", () => {
  it("lit le poids sans le prendre pour la rue", () => {
    const r = analyserCode("MARTIN Julie\n12 rue des Lilas\n69230 Saint-Genis-Laval\nPoids : 2,3 kg\n09876543210987");
    expect(r.poids).toBe(2.3);
    expect(r.adresse).toBe("12 rue des Lilas, 69230 Saint-Genis-Laval");
    expect(r.code).toBe("09876543210987");
  });
  it("JSON avec poids en grammes", () => {
    expect(analyserCode('{"address":"3 avenue Foch, 69006 Lyon","weight":"850 g"}').poids).toBe(0.85);
  });
  it("pas de poids sur un simple numéro de suivi", () => {
    expect(analyserCode("01234567890123").poids).toBeUndefined();
  });
});
