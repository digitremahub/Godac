import { describe, expect, it } from "vitest";
import { profilDeLEntree, schemaMouvement, validerMouvement, type EntreeMouvement } from "@/lib/stock/mouvements";
import type { CleProfil, ProfilsConfig } from "@/lib/stock/profils";

const SITE = "11111111-1111-4111-8111-111111111111";
const ART = "22222222-2222-4222-8222-222222222222";
const base = { cle: "cle-test-0001", site_id: SITE };
const lire = (e: Record<string, unknown>) => schemaMouvement.parse({ ...base, ...e }) as EntreeMouvement;
const valider = (e: Record<string, unknown>, profils: CleProfil[], config?: ProfilsConfig | null, extra: Record<string, unknown> = {}) => validerMouvement(lire(e), { profils, role: "chauffeur", config, ...extra });
const refus = (r: ReturnType<typeof valider>) => (r.ok ? "" : r.erreur);

describe("entrée d'une unité qui arrive avec un code : on le garde", () => {
  it("le code d'origine reste le code principal, aucun code interne n'est ajouté d'office", () => {
    const r = valider({ type: "entree", code: "003456789012345678", type_unite: "colis" }, ["messagerie"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toMatchObject({ p_unite_code: "003456789012345678", p_code_interne: null });
  });
  it("code interne complémentaire demandé : transmis séparément, le code principal ne change pas", () => {
    const r = valider({ type: "entree", code: "EXT-42", type_unite: "colis", code_interne: " TRA-2026-000007 " }, ["messagerie"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toMatchObject({ p_unite_code: "EXT-42", p_code_interne: "TRA-2026-000007" });
  });
  it("un code interne mal formé est refusé avec un message clair", () => {
    expect(refus(valider({ type: "entree", code: "EXT-42", type_unite: "colis", code_interne: "n'importe quoi" }, ["messagerie"]))).toMatch(/Générer un code/);
  });
  it("un code interne ne se rattache ni à un article, ni à une sortie", () => {
    expect(refus(valider({ type: "entree", article_id: ART, quantite: 1, code_interne: "TRA-2026-000007" }, ["vrac"]))).toMatch(/pas à un article/);
    expect(refus(valider({ type: "sortie", code: "EXT-42", code_interne: "TRA-2026-000007" }, ["messagerie"]))).toMatch(/entrée d'une unité/);
  });
});

describe("entrée par scan d'un code pré-imprimé inconnu : l'unité est créée avec ce code", () => {
  it("l'entrée d'un code jamais vu est acceptée (type d'unité requis, comme avant) et garde le code lu", () => {
    const r = valider({ type: "entree", code: "TRA-2026-000123", type_unite: "colis" }, ["messagerie"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toMatchObject({ p_type: "entree", p_unite_code: "TRA-2026-000123", p_type_unite: "colis", p_code_interne: null });
  });
  it("le même code lu en rafale produit la même demande (la clé d'idempotence évite le doublon)", () => {
    const a = valider({ type: "entree", code: "TRA-2026-000123", type_unite: "colis" }, ["messagerie"]);
    const b = valider({ type: "entree", code: "TRA-2026-000123", type_unite: "colis" }, ["messagerie"]);
    expect(a).toEqual(b);
  });
});

describe("profil de l'entrée", () => {
  it("un seul profil possible : il est choisi d'office", () => {
    expect(profilDeLEntree(["messagerie", "pharmacie"], null, "unites")).toEqual({ ok: true, profil: "messagerie" });
    expect(profilDeLEntree(["messagerie", "pharmacie"], null, "articles")).toEqual({ ok: true, profil: "pharmacie" });
  });
  it("plusieurs profils dont l'un impose des champs : le choix est exigé", () => {
    expect(profilDeLEntree(["sante", "messagerie"], null, "unites")).toMatchObject({ ok: false });
    expect(profilDeLEntree(["sante", "messagerie"], null, "unites", "messagerie")).toEqual({ ok: true, profil: "messagerie" });
  });
  it("plusieurs profils sans champ obligatoire : pas de choix à imposer (comportement historique)", () => {
    expect(profilDeLEntree(["messagerie", "palettes"], null, "unites")).toEqual({ ok: true, profil: null });
  });
  it("profil demandé non actif ou de l'autre type : refusé", () => {
    expect(profilDeLEntree(["messagerie"], null, "unites", "sante")).toMatchObject({ ok: false });
    expect(profilDeLEntree(["messagerie", "pharmacie"], null, "unites", "pharmacie")).toMatchObject({ ok: false });
  });
  it("aucun profil de ce type : pas de profil, la suite refuse déjà le mouvement", () => {
    expect(profilDeLEntree(["pharmacie"], null, "unites")).toEqual({ ok: true, profil: null });
  });
});

describe("champs obligatoires côté API (le profil les impose)", () => {
  it("santé : la température est obligatoire pour un échantillon", () => {
    const r = valider({ type: "entree", code: "ECH-1", type_unite: "colis" }, ["sante"]);
    expect(refus(r)).toMatch(/Champ obligatoire.*Température cible/);
    const ok = valider({ type: "entree", code: "ECH-1", type_unite: "colis", attributs: { temperature: "frais" } }, ["sante"]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.params).toMatchObject({ p_profil: "sante", p_attributs: { temperature: "frais" } });
  });
  it("pharmacie : lot et DLC obligatoires à l'entrée d'un article", () => {
    expect(refus(valider({ type: "entree", article_id: ART, quantite: 3 }, ["pharmacie"]))).toMatch(/Champs obligatoires.*Lot.*Date limite/);
    expect(refus(valider({ type: "entree", article_id: ART, quantite: 3, lot: "L1" }, ["pharmacie"]))).toMatch(/Date limite/);
    const ok = valider({ type: "entree", article_id: ART, quantite: 3, lot: "L1", dlc: "2027-01-31" }, ["pharmacie"]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.params).toMatchObject({ p_profil: "pharmacie", p_lot: "L1", p_dlc: "2027-01-31" });
  });
  it("la sortie d'un article n'exige ni lot ni DLC du profil (seul le suivi de l'article s'applique)", () => {
    expect(valider({ type: "sortie", article_id: ART, quantite: 1 }, ["pharmacie"]).ok).toBe(true);
  });
  it("une entreprise peut rendre le poids obligatoire pour ses colis", () => {
    const config: ProfilsConfig = { version: 1, actifs: ["messagerie"], profils: { messagerie: { champs: { poids: "requis" } } } };
    expect(refus(valider({ type: "entree", code: "C1", type_unite: "colis" }, ["messagerie"], config))).toMatch(/Poids/);
    expect(valider({ type: "entree", code: "C1", type_unite: "colis", poids_kg: 2.4 }, ["messagerie"], config).ok).toBe(true);
  });
  it("une unité déjà connue garde ses valeurs : la ré-entrée n'exige pas de les ressaisir", () => {
    const r = valider({ type: "entree", code: "ECH-1", type_unite: "colis" }, ["sante"], null, { uniteExistante: { temperature: "frais" } });
    expect(r.ok).toBe(true);
  });
  it("champ rendu facultatif : plus exigé (pharmacie sans DLC obligatoire)", () => {
    const config: ProfilsConfig = { version: 1, actifs: ["pharmacie"], profils: { pharmacie: { champs: { dlc: "affiche" } } } };
    expect(valider({ type: "entree", article_id: ART, quantite: 1, lot: "L1" }, ["pharmacie"], config).ok).toBe(true);
  });
  it("profils sans obligation (messagerie) : aucun champ exigé", () => {
    expect(valider({ type: "entree", code: "C1", type_unite: "colis" }, ["messagerie"]).ok).toBe(true);
  });
  it("lot et DLC d'une unité se saisissent dans ses attributs, pas dans les champs « article »", () => {
    expect(refus(valider({ type: "entree", code: "C1", type_unite: "colis", lot: "L1" }, ["messagerie"]))).toMatch(/attributs/);
  });
});

describe("attributs transmis à la fonction SQL", () => {
  it("nature, température, fragile, urgent, consigne : transmis à l'entrée seulement", () => {
    const attributs = { nature: "medicament", temperature: "frais", fragile: true, urgent: true, consigne: "À garder au frais" };
    const e = valider({ type: "entree", code: "C1", type_unite: "colis", attributs }, ["messagerie"]);
    expect(e.ok && e.params.p_attributs).toEqual(attributs);
    const s = valider({ type: "sortie", code: "C1", attributs }, ["messagerie"]);
    expect(s.ok && s.params.p_attributs).toBeNull();
  });
  it("attributs invalides refusés par le schéma", () => {
    expect(() => lire({ type: "entree", code: "C1", type_unite: "colis", attributs: { nature: "voiture" } })).toThrow();
    expect(() => lire({ type: "entree", code: "C1", type_unite: "colis", attributs: { consigne: "x".repeat(121) } })).toThrow();
    expect(() => lire({ type: "entree", code: "C1", type_unite: "colis", attributs: { nom_patient: "Dupont" } })).toThrow();
  });
});
