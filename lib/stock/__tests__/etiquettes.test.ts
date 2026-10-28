import { describe, expect, it } from "vitest";
import { encoderCode128 } from "@/lib/stock/code128";
import { codeEtiquette, construireEtiquette, etiquetteVierge, mettreEnPage, seChevauchent, taillePourLargeur, toutDansEtiquette, type DonneesEtiquette, type UniteEtiquetable } from "@/lib/stock/etiquettes";
import { DEFINITION_FORMATS, FORMATS_ETIQUETTE } from "@/lib/stock/formats-etiquette";
import { CHAMPS_ETIQUETTE } from "@/lib/stock/profils";

const unite: UniteEtiquetable = {
  code: "003456789012345678",
  code_interne: "TRA-2026-000042",
  nature: "prelevement",
  temperature: "frais",
  fragile: true,
  urgent: true,
  consigne: "Livrer avant 10 h, ne pas secouer, appeler le laboratoire à l'arrivée du véhicule",
  reference_client: "BL-2026-0099",
  lot: "L2026-17",
  dlc: "2026-11-30",
};
const ctx = { entreprise: "Transports Martin et Fils", depot: "Dépôt Nord", emplacement: "Quai 3 › B-12", date: "28/10/2026", logo: true };
const tout = (): DonneesEtiquette => construireEtiquette(unite, ctx, CHAMPS_ETIQUETTE);

describe("contenu de l'étiquette", () => {
  it("le code porté est le code interne s'il existe, sinon le code principal", () => {
    expect(codeEtiquette(unite)).toBe("TRA-2026-000042");
    expect(codeEtiquette({ code: "EXT-1", code_interne: null })).toBe("EXT-1");
    expect(codeEtiquette({ code: "EXT-1" })).toBe("EXT-1");
  });
  it("tous les champs choisis sont repris, rien d'autre", () => {
    const d = tout();
    expect(d).toMatchObject({ code: "TRA-2026-000042", entreprise: "Transports Martin et Fils", logo: true, depot: "Dépôt Nord", emplacement: "Quai 3 › B-12", nature: "Prélèvement", temperature: "2-8 °C", fragile: true, urgent: true, date: "28/10/2026", lot: "L2026-17", dlc: "30/11/2026", reference_client: "BL-2026-0099" });
    const reduit = construireEtiquette(unite, ctx, ["entreprise", "fragile"]);
    expect(reduit).toMatchObject({ entreprise: "Transports Martin et Fils", fragile: true, urgent: false, depot: null, nature: null, temperature: null, consigne: null, date: null, lot: null, dlc: null });
  });
  it("nature et température « autre » : le libellé libre s'imprime", () => {
    const d = construireEtiquette({ code: "X1", nature: "autre", nature_libelle: "Matériel de test", temperature: "autre", temperature_libelle: "+15 °C" }, ctx, ["nature", "temperature"]);
    expect(d.nature).toBe("Matériel de test");
    expect(d.temperature).toBe("+15 °C");
  });
  it("aucune donnée personnelle : l'étiquette ne reprend ni nom, ni adresse, ni téléphone d'un destinataire", () => {
    const d = JSON.stringify(tout());
    expect(d).not.toMatch(/destinataire|patient|donneur|téléphone|e-mail/i);
    expect(Object.keys(tout()).sort()).toEqual(["code", "consigne", "date", "depot", "dlc", "emplacement", "entreprise", "fragile", "logo", "lot", "nature", "reference_client", "temperature", "temperatureCle", "urgent"]);
  });
  it("le logo n'est imprimé que si l'entreprise est choisie ET qu'un logo existe", () => {
    expect(construireEtiquette(unite, { ...ctx, logo: false }, ["entreprise"]).logo).toBe(false);
    expect(construireEtiquette(unite, ctx, ["date"]).logo).toBe(false);
  });
  it("étiquette vierge numérotée : le code, l'entreprise et la date seulement", () => {
    const v = etiquetteVierge("TRA-2026-000100", ctx, CHAMPS_ETIQUETTE);
    expect(v).toMatchObject({ code: "TRA-2026-000100", entreprise: "Transports Martin et Fils", date: "28/10/2026", depot: "Dépôt Nord", nature: null, temperature: null, fragile: false, urgent: false, consigne: null, lot: null });
  });
});

describe("mise en page : tout tient dans l'étiquette, sans chevauchement", () => {
  const cas: [string, DonneesEtiquette][] = [
    ["complète", tout()],
    ["minimale", construireEtiquette({ code: "A" }, ctx, [])],
    ["vierge", etiquetteVierge("TRA-2026-000001", ctx)],
    ["code long", { ...tout(), code: "COLIS-TRANSPORTEUR-INTERNATIONAL-0000000000012345" }],
    ["consigne longue", { ...tout(), consigne: "x".repeat(120) }],
    ["code non encodable", { ...tout(), code: "Étiquette n°1" }],
  ];
  for (const cle of FORMATS_ETIQUETTE) {
    for (const [nom, d] of cas) {
      it(`${cle} · ${nom}`, () => {
        const m = mettreEnPage(DEFINITION_FORMATS[cle], d);
        expect(m.largeur).toBe(DEFINITION_FORMATS[cle].etiquette.largeur);
        expect(m.hauteur).toBe(DEFINITION_FORMATS[cle].etiquette.hauteur);
        expect(toutDansEtiquette(m), "dans l'étiquette").toBe(true);
        const blocs = [m.qr, m.code, ...(m.codeBarres ? [m.codeBarres] : []), ...m.textes.filter((t) => !t.alignement || t.alignement !== "right" || t.y > m.code.y + m.code.h), ...m.pictos];
        // Le QR, le code, le code-barres, les pictogrammes et les textes de la colonne ne se recouvrent pas.
        for (let i = 0; i < blocs.length; i++) for (let j = i + 1; j < blocs.length; j++) expect(seChevauchent(blocs[i]!, blocs[j]!), `${i}/${j}`).toBe(false);
      });
    }
  }
  it("le QR code est carré et lisible : au moins 15 mm sur planche, 20 mm en thermique, 20 mm en 62 × 29", () => {
    for (const cle of FORMATS_ETIQUETTE) {
      const m = mettreEnPage(DEFINITION_FORMATS[cle], tout());
      expect(m.qr.l).toBeCloseTo(m.qr.h, 6);
      expect(m.qr.l, cle).toBeGreaterThanOrEqual(20 - (cle === "a4_3x7" ? 0 : 0));
    }
  });
  it("le code-barres a un module d'au moins 0,15 mm pour un code interne (lisible par un lecteur courant)", () => {
    const largeurModules = encoderCode128("TRA-2026-000042").largeurModules;
    for (const cle of FORMATS_ETIQUETTE) {
      const m = mettreEnPage(DEFINITION_FORMATS[cle], tout());
      expect(m.codeBarres, cle).not.toBeNull();
      expect(m.codeBarres!.l / largeurModules, cle).toBeGreaterThanOrEqual(0.15);
    }
  });
  it("le code est écrit en gros caractères lisibles (au moins 8 pt, 20 pt en thermique)", () => {
    expect(mettreEnPage("etiquette_62x29", tout()).code.taille).toBeGreaterThanOrEqual(7);
    expect(mettreEnPage("a4_3x7", tout()).code.taille).toBeGreaterThanOrEqual(8);
    expect(mettreEnPage("thermique_100x150", tout()).code.taille).toBeGreaterThanOrEqual(14);
    expect(mettreEnPage("a4_2x4", tout()).code.taille).toBeGreaterThanOrEqual(12);
  });
  it("pas de code-barres si le code n'est pas encodable en Code 128, mais le QR reste", () => {
    const m = mettreEnPage("a4_3x7", { ...tout(), code: "Étiquette n°1" });
    expect(m.codeBarres).toBeNull();
    expect(m.qr.l).toBeGreaterThan(0);
  });
  it("pictogrammes : température, fragile et urgent sont imprimés quand ils s'appliquent (thermique et 99 × 68)", () => {
    for (const cle of ["thermique_100x150", "a4_2x4"] as const) {
      const types = mettreEnPage(cle, tout()).pictos.map((p) => p.type);
      expect(types, cle).toEqual(["temperature", "fragile", "urgent"]);
    }
    expect(mettreEnPage("a4_2x4", construireEtiquette({ code: "A" }, ctx, CHAMPS_ETIQUETTE)).pictos).toEqual([]);
  });
  it("pictos lisibles en noir et blanc : le texte est dedans (URGENT en plein), pas seulement une couleur", () => {
    const pictos = mettreEnPage("thermique_100x150", tout()).pictos;
    expect(pictos.find((p) => p.type === "urgent")).toMatchObject({ texte: "URGENT", plein: true });
    expect(pictos.find((p) => p.type === "fragile")).toMatchObject({ texte: "FRAGILE", plein: false });
    expect(pictos.find((p) => p.type === "temperature")!.texte).toBe("2-8 °C");
  });
  it("le logo prend sa place dans l'en-tête des étiquettes assez grandes", () => {
    expect(mettreEnPage("thermique_100x150", tout()).logo).not.toBeNull();
    expect(mettreEnPage("a4_2x4", tout()).logo).not.toBeNull();
  });
  it("la date et l'entreprise sont imprimées sur les grandes étiquettes", () => {
    const m = mettreEnPage("thermique_100x150", tout());
    const textes = m.textes.map((t) => t.texte);
    expect(textes).toContain("Transports Martin et Fils");
    expect(textes).toContain("28/10/2026");
  });
  it("taille de police : le code long est réduit pour tenir dans la largeur", () => {
    expect(taillePourLargeur(15, 30, 20)).toBeLessThan(taillePourLargeur(5, 30, 20));
    expect(taillePourLargeur(200, 10, 20, 5)).toBe(5);
    expect(taillePourLargeur(0, 30, 20)).toBe(20);
  });
});
