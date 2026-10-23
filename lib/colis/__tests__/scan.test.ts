import { describe, expect, it } from "vitest";
import {
  AntiDoublon,
  choisirFormats,
  delaiProchaineDetection,
  FORMATS_COLIS,
  messageErreurCamera,
  normaliserCodeLu,
  validerSaisieManuelle,
} from "@/lib/colis/scan";

describe("formats lus", () => {
  it("couvre les formats des colis", () => {
    for (const f of ["qr_code", "data_matrix", "code_128", "code_39", "ean_13", "itf", "pdf417"]) expect(FORMATS_COLIS).toContain(f);
  });
  it("garde les formats supportés par le navigateur", () => {
    expect(choisirFormats(["qr_code", "code_128", "data_matrix", "upc_a"])).toEqual(["qr_code", "data_matrix", "code_128"]);
  });
  it("écarte un détecteur sans Code 128 ou sans Datamatrix", () => {
    expect(choisirFormats(["qr_code"])).toBeNull();
    expect(choisirFormats(["qr_code", "code_128"])).toBeNull();
    expect(choisirFormats([])).toBeNull();
  });
});

describe("normalisation d'un code lu", () => {
  it("retire espaces, retour chariot et séparateurs de contrôle", () => {
    expect(normaliserCodeLu("  6A12345678\r\n")).toBe("6A12345678");
    expect(normaliserCodeLu("AB\u001d12\u0000")).toBe("AB12");
  });
  it("garde les retours à la ligne d'un QR d'adresse", () => {
    expect(normaliserCodeLu("Jean Dupont\n3 rue Foch\n69006 Lyon")).toBe("Jean Dupont\n3 rue Foch\n69006 Lyon");
  });
  it("rejette le vide, le non-texte et les contenus démesurés", () => {
    expect(normaliserCodeLu("   \n")).toBeNull();
    expect(normaliserCodeLu(undefined)).toBeNull();
    expect(normaliserCodeLu(42)).toBeNull();
    expect(normaliserCodeLu("x".repeat(1001))).toBeNull();
  });
});

describe("saisie manuelle", () => {
  it("accepte un numéro et retire les espaces", () => {
    expect(validerSaisieManuelle(" 6A 1234 5678 ")).toEqual({ ok: true, code: "6A12345678" });
    expect(validerSaisieManuelle("AB-12/34")).toEqual({ ok: true, code: "AB-12/34" });
  });
  it("refuse vide, trop court, trop long et caractères étranges, en français", () => {
    for (const s of ["", "   ", "123", "a".repeat(81), "12 34 <script>"]) {
      const r = validerSaisieManuelle(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.erreur).toMatch(/numéro|Numéro|Saisissez/);
    }
  });
});

describe("anti-doublon", () => {
  it("ignore le même code pendant 2 s puis le réaccepte", () => {
    const a = new AntiDoublon();
    expect(a.accepter("A1", 0)).toBe(true);
    expect(a.accepter("A1", 1999)).toBe(false);
    expect(a.accepter("A1", 4000)).toBe(true);
  });
  it("un code resté devant la caméra n'est remonté qu'une fois", () => {
    const a = new AntiDoublon();
    let remontes = 0;
    for (let t = 0; t <= 10_000; t += 150) if (a.accepter("A1", t)) remontes++;
    expect(remontes).toBe(1);
  });
  it("laisse passer un autre code immédiatement", () => {
    const a = new AntiDoublon();
    a.accepter("A1", 0);
    expect(a.accepter("B2", 100)).toBe(true);
  });
  it("oublier() et reinitialiser() permettent de rescanner", () => {
    const a = new AntiDoublon();
    a.accepter("A1", 0);
    a.oublier("A1");
    expect(a.accepter("A1", 10)).toBe(true);
    a.reinitialiser();
    expect(a.accepter("A1", 20)).toBe(true);
  });
  it("ne grossit pas sans limite", () => {
    const a = new AntiDoublon();
    for (let i = 0; i < 1000; i++) a.accepter("C" + i, i * 10);
    expect(a.accepter("C0", 1_000_000)).toBe(true);
  });
});

describe("cadence de détection", () => {
  it("reste entre 100 et 600 ms", () => {
    expect(delaiProchaineDetection(5, true)).toBe(100);
    expect(delaiProchaineDetection(5, false)).toBe(200);
    expect(delaiProchaineDetection(500, false)).toBe(300);
    expect(delaiProchaineDetection(5000, false)).toBe(600);
  });
});

describe("erreurs caméra", () => {
  it("explique un refus d'autorisation", () => {
    expect(messageErreurCamera({ name: "NotAllowedError" })).toMatch(/refusé.*Autorisez/);
  });
  it("distingue absente, occupée, inconnue et non sécurisée", () => {
    expect(messageErreurCamera({ name: "NotFoundError" })).toMatch(/Aucune caméra/);
    expect(messageErreurCamera({ name: "NotReadableError" })).toMatch(/autre application/);
    expect(messageErreurCamera(new Error("?"))).toMatch(/indisponible/);
    expect(messageErreurCamera(null, false)).toMatch(/https/);
  });
  it("propose toujours la saisie manuelle", () => {
    for (const n of ["NotAllowedError", "NotFoundError", "NotReadableError", "Autre"]) expect(messageErreurCamera({ name: n })).toMatch(/à la main/);
  });
});
