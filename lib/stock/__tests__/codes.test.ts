import { describe, expect, it } from "vitest";
import {
  CODES_MAX_PAR_APPEL,
  COMPTEUR_MAX,
  analyserCodeInterne,
  anneeDeParis,
  contenuQr,
  estCodeInterne,
  formaterCodeInterne,
  nettoyerCode,
  nombreCodesValide,
  normaliserPrefixe,
  planifierCodes,
  prefixeParDefaut,
  prefixeValide,
  resoudreCode,
  verifierCodeInterne,
  verifierCodePrincipal,
  type UniteCodee,
} from "@/lib/stock/codes";

describe("préfixe", () => {
  it("2 à 6 caractères A-Z0-9", () => {
    for (const p of ["TR", "TRA", "TRANS1", "A1", "123456"]) expect(prefixeValide(p), p).toBe(true);
    for (const p of ["T", "TRANSPO", "tra", "TR-A", "TR A", "É1", "", null, 12]) expect(prefixeValide(p), String(p)).toBe(false);
  });
  it("saisie nettoyée : majuscules, accents, espaces et tirets retirés", () => {
    expect(normaliserPrefixe(" tra ")).toBe("TRA");
    expect(normaliserPrefixe("t-r a")).toBe("TRA");
    expect(normaliserPrefixe("Éco")).toBe("ECO");
    expect(normaliserPrefixe("x")).toBeNull();
    expect(normaliserPrefixe("trop-long-prefixe")).toBeNull();
    expect(normaliserPrefixe(42)).toBeNull();
  });
  it("défaut dérivé du nom de l'entreprise", () => {
    expect(prefixeParDefaut("Transdev")).toBe("TRA");
    expect(prefixeParDefaut("Transports Martin et Fils")).toBe("TMF");
    expect(prefixeParDefaut("SARL Dupont Express")).toBe("DE");
    expect(prefixeParDefaut("Société de Transports Rapides du Nord")).toBe("TRN");
    expect(prefixeParDefaut("Éts Hélène & Co")).toBe("HC");
    expect(prefixeParDefaut("   ")).toBe("STK");
    expect(prefixeParDefaut("X")).toBe("STK");
    expect(prefixeParDefaut(null)).toBe("STK");
    expect(prefixeValide(prefixeParDefaut("Pharmacie du Centre 24"))).toBe(true);
  });
});

describe("format PREFIXE-AAAA-NNNNNN", () => {
  it("formate l'année et le compteur sur 6 chiffres", () => {
    expect(formaterCodeInterne("TRA", 2026, 1)).toBe("TRA-2026-000001");
    expect(formaterCodeInterne("TRA", 2026, 123456)).toBe("TRA-2026-123456");
    expect(formaterCodeInterne("AB", 2027, COMPTEUR_MAX)).toBe("AB-2027-999999");
  });
  it("refuse les valeurs hors limites", () => {
    expect(() => formaterCodeInterne("TRA", 2026, 0)).toThrow();
    expect(() => formaterCodeInterne("TRA", 2026, COMPTEUR_MAX + 1)).toThrow();
    expect(() => formaterCodeInterne("tra", 2026, 1)).toThrow();
    expect(() => formaterCodeInterne("TRA", 26, 1)).toThrow();
  });
  it("analyse : un code interne se décompose, un code transporteur non", () => {
    expect(analyserCodeInterne("TRA-2026-000042")).toEqual({ prefixe: "TRA", annee: 2026, numero: 42 });
    expect(estCodeInterne("TRA-2026-000042")).toBe(true);
    for (const c of ["003456789012345678", "TRA-2026-42", "tra-2026-000042", "TRA-26-000042", "TRA-2026-0000421", "COLIS0001", "TRA_2026_000042"]) expect(estCodeInterne(c), c).toBe(false);
  });
  it("le QR code contient uniquement le code", () => {
    expect(contenuQr("TRA-2026-000042")).toBe("TRA-2026-000042");
  });
  it("année de Paris : bascule au 1er janvier à minuit heure de Paris", () => {
    expect(anneeDeParis(new Date("2026-12-31T22:59:59Z"))).toBe(2026);
    expect(anneeDeParis(new Date("2026-12-31T23:00:00Z"))).toBe(2027);
    expect(anneeDeParis(new Date("2026-06-30T22:30:00Z"))).toBe(2026);
  });
});

describe("génération : compteur, collisions, limite", () => {
  it("numéros contigus à partir du dernier attribué", () => {
    const p = planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: 0, nombre: 3 });
    expect(p.codes).toEqual(["TRA-2026-000001", "TRA-2026-000002", "TRA-2026-000003"]);
    expect(p.dernier).toBe(3);
    expect(planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: 3, nombre: 2 }).codes).toEqual(["TRA-2026-000004", "TRA-2026-000005"]);
  });
  it("deux générations successives ne donnent jamais le même code", () => {
    const a = planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: 0, nombre: 500 });
    const b = planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: a.dernier, nombre: 500 });
    expect(new Set([...a.codes, ...b.codes]).size).toBe(1000);
  });
  it("le compteur est par année : une nouvelle année repart de 1", () => {
    expect(planifierCodes({ prefixe: "TRA", annee: 2027, dernierActuel: 0, nombre: 1 }).codes).toEqual(["TRA-2027-000001"]);
  });
  it("collision avec un code déjà saisi : le numéro est sauté, le nombre demandé est respecté", () => {
    const p = planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: 0, nombre: 3, occupes: new Set(["TRA-2026-000002"]) });
    expect(p.codes).toEqual(["TRA-2026-000001", "TRA-2026-000003", "TRA-2026-000004"]);
    expect(p.sautes).toEqual([2]);
    expect(p.dernier).toBe(4);
  });
  it("limite : 1 à 500 par appel", () => {
    expect(CODES_MAX_PAR_APPEL).toBe(500);
    for (const n of [1, 24, 50, 100, 500]) expect(nombreCodesValide(n), String(n)).toBe(true);
    for (const n of [0, -1, 501, 1.5, NaN, "24", null]) expect(nombreCodesValide(n), String(n)).toBe(false);
    expect(() => planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: 0, nombre: 501 })).toThrow();
  });
  it("compteur épuisé au-delà de 999 999", () => {
    expect(planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: COMPTEUR_MAX - 2, nombre: 2 }).dernier).toBe(COMPTEUR_MAX);
    expect(() => planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: COMPTEUR_MAX - 1, nombre: 2 })).toThrow("stock_compteur_epuise");
  });
  it("changer de préfixe ne touche pas aux anciens codes (le compteur continue)", () => {
    const avant = planifierCodes({ prefixe: "TRA", annee: 2026, dernierActuel: 0, nombre: 2 });
    const apres = planifierCodes({ prefixe: "NEW", annee: 2026, dernierActuel: avant.dernier, nombre: 1 });
    expect(apres.codes).toEqual(["NEW-2026-000003"]);
    expect(avant.codes.every(estCodeInterne)).toBe(true);
  });
});

describe("résolution : code principal ET code interne", () => {
  const unites: UniteCodee[] = [
    { id: "u1", code: "003456789012345678", code_interne: "TRA-2026-000001" },
    { id: "u2", code: "COLIS-42", code_interne: null },
    { id: "u3", code: "TRA-2026-000009", code_interne: null },
  ];
  it("le scan retrouve l'unité par son code d'origine", () => {
    expect(resoudreCode("003456789012345678", unites)).toEqual({ unite: unites[0], via: "code" });
    expect(resoudreCode(" COLIS-42 ", unites)).toEqual({ unite: unites[1], via: "code" });
  });
  it("le scan retrouve la même unité par son code interne", () => {
    expect(resoudreCode("TRA-2026-000001", unites)).toEqual({ unite: unites[0], via: "code_interne" });
  });
  it("une unité dont le code interne est le code principal se retrouve aussi", () => {
    expect(resoudreCode("TRA-2026-000009", unites)).toEqual({ unite: unites[2], via: "code" });
  });
  it("code inconnu ou vide : aucune unité", () => {
    expect(resoudreCode("INCONNU", unites)).toBeNull();
    expect(resoudreCode("   ", unites)).toBeNull();
    expect(resoudreCode("x".repeat(81), unites)).toBeNull();
  });
  it("nettoyage : caractères de contrôle retirés, espaces repliés", () => {
    expect(nettoyerCode("\u0000 AB\n  CD\t")).toBe("AB CD");
    expect(nettoyerCode(12)).toBeNull();
  });
});

describe("aucune ambiguïté : un code ne désigne qu'une unité", () => {
  const unites: UniteCodee[] = [
    { id: "u1", code: "EXT-1", code_interne: "TRA-2026-000001" },
    { id: "u2", code: "EXT-2", code_interne: null },
  ];
  const emis = new Set(["TRA-2026-000001", "TRA-2026-000002", "TRA-2026-000003"]);
  it("un code interne libre peut être rattaché", () => {
    expect(verifierCodeInterne("TRA-2026-000002", "u2", unites, emis)).toEqual({ ok: true });
  });
  it("refus : le code interne est déjà celui d'une autre unité", () => {
    const v = verifierCodeInterne("TRA-2026-000001", "u2", unites, emis);
    expect(v).toMatchObject({ ok: false, erreur: "stock_code_ambigu" });
    expect(v.ok ? "" : v.message).toMatch(/autre unité/);
  });
  it("refus : le code interne égale le code principal d'une autre unité", () => {
    const autres: UniteCodee[] = [...unites, { id: "u3", code: "TRA-2026-000003", code_interne: null }];
    expect(verifierCodeInterne("TRA-2026-000003", "u2", autres, emis)).toMatchObject({ ok: false, erreur: "stock_code_ambigu" });
  });
  it("refus : un nouveau code externe égal au code interne d'une autre unité", () => {
    expect(verifierCodePrincipal("TRA-2026-000001", null, unites)).toMatchObject({ ok: false, erreur: "stock_code_ambigu" });
    expect(verifierCodePrincipal("EXT-2", null, unites)).toMatchObject({ ok: false, erreur: "stock_code_ambigu" });
  });
  it("une unité garde son propre code (pas d'auto-conflit)", () => {
    expect(verifierCodePrincipal("EXT-1", "u1", unites)).toEqual({ ok: true });
    expect(verifierCodeInterne("TRA-2026-000001", "u1", unites, emis)).toEqual({ ok: true });
  });
  it("refus : ce n'est pas un code interne, ou il n'a pas été généré pour l'entreprise", () => {
    expect(verifierCodeInterne("EXT-9", "u2", unites, emis)).toMatchObject({ ok: false, erreur: "stock_code_interne_invalide" });
    expect(verifierCodeInterne("ZZZ-2026-000050", "u2", unites, emis)).toMatchObject({ ok: false, erreur: "stock_code_interne_inconnu" });
  });
});
