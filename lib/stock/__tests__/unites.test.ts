import { describe, expect, it } from "vitest";
import { ENTETE_EXPORT_UNITES, EXPORT_MAX_UNITES, PAR_PAGE_UNITES, cellulesUnite, clauseRecherche, csvUnites, lireFiltresUnites, nomFichierUnites, type UniteExport } from "@/lib/stock/unites";

const unite = (p: Partial<UniteExport> = {}): UniteExport => ({
  code: "003456789012345678",
  code_interne: "TRA-2026-000042",
  type_unite: "colis",
  poids_kg: 2.5,
  volume_m3: null,
  sscc: null,
  statut: "dans_depot",
  profil: "sante",
  nature: "prelevement",
  nature_libelle: null,
  temperature: "frais",
  temperature_libelle: null,
  temperature_releve: 4.5,
  fragile: true,
  urgent: false,
  consigne: "=SOMME(A1)",
  reference_client: "BL-1",
  lot: "L1",
  dlc: "2026-11-30",
  depot: "Dépôt Nord",
  emplacement: "Quai 3",
  ...p,
});

describe("filtres de la liste et de l'export", () => {
  it("lit les filtres valides et ignore les autres", () => {
    const f = lireFiltresUnites({ q: " TRA-2026 ", statut: "dans_depot", site: "11111111-1111-4111-8111-111111111111", nature: "prelevement", temperature: "frais", urgent: "1", fragile: "1", page: "3" });
    expect(f).toEqual({ q: "TRA-2026", statut: "dans_depot", site: "11111111-1111-4111-8111-111111111111", nature: "prelevement", temperature: "frais", urgent: true, fragile: true, page: 3 });
    expect(lireFiltresUnites({ statut: "inconnu", site: "x", nature: "voiture", temperature: "chaud", urgent: "oui", page: "-4" })).toEqual({ q: null, statut: null, site: null, nature: null, temperature: null, urgent: false, fragile: false, page: 1 });
  });
  it("la recherche libre neutralise les caractères spéciaux et borne la longueur", () => {
    expect(lireFiltresUnites({ q: "a,b(c)*%_d" }).q).toBe("a b c d");
    expect(lireFiltresUnites({ q: "x".repeat(100) }).q).toHaveLength(60);
  });
  it("la recherche porte sur le code principal ET le code interne, le SSCC, la référence client et le lot", () => {
    expect(clauseRecherche("TRA", true).split(",")).toEqual(["code.ilike.%TRA%", "code_interne.ilike.%TRA%", "sscc.ilike.%TRA%", "reference_client.ilike.%TRA%", "lot.ilike.%TRA%"]);
    expect(clauseRecherche("TRA", false)).toBe("code.ilike.%TRA%,sscc.ilike.%TRA%");
  });
  it("50 par page, 10 000 lignes au plus par export", () => {
    expect(PAR_PAGE_UNITES).toBe(50);
    expect(EXPORT_MAX_UNITES).toBe(10000);
  });
});

describe("export CSV / Excel des unités", () => {
  it("en-tête : code principal, code interne, nature et température", () => {
    expect(ENTETE_EXPORT_UNITES.slice(0, 5)).toEqual(["Code principal", "Code interne", "Type", "Nature", "Température"]);
    expect(ENTETE_EXPORT_UNITES).toContain("Consigne");
    expect(ENTETE_EXPORT_UNITES).toContain("Référence client");
  });
  it("une ligne par unité, autant de cellules que de colonnes", () => {
    const c = cellulesUnite(unite());
    expect(c).toHaveLength(ENTETE_EXPORT_UNITES.length);
    expect(c.slice(0, 5)).toEqual(["003456789012345678", "TRA-2026-000042", "Colis", "Prélèvement / échantillon biologique", "Frais (2 à 8 °C)"]);
    expect(c[5]).toBe(4.5);
    expect(c.slice(6, 8)).toEqual(["oui", "non"]);
    expect(c[11]).toBe("30/11/2026");
    expect(c.at(-3)).toBe("En dépôt");
  });
  it("unité sans attribut : cellules vides, jamais « null »", () => {
    const c = cellulesUnite(unite({ code_interne: null, nature: null, temperature: null, temperature_releve: null, consigne: null, reference_client: null, lot: null, dlc: null, poids_kg: null, fragile: false }));
    expect(c.join("|")).not.toMatch(/null|undefined/);
    expect(c[1]).toBe("");
  });
  it("CSV Excel France : BOM, point-virgule, formules neutralisées, troncature annoncée", () => {
    const csv = csvUnites([unite()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lignes = csv.split("\r\n");
    expect(lignes[0]).toBe("﻿" + ENTETE_EXPORT_UNITES.join(";"));
    expect(lignes[1]).not.toContain(";=SOMME");
    expect(lignes[1]).toContain("4,5");
    expect(csvUnites([], { tronque: true })).toContain("Export tronqué");
  });
  it("le code à zéros en tête reste un texte dans le CSV", () => {
    expect(csvUnites([unite({ code: "000123" })]).split("\r\n")[1]).toMatch(/^000123;/);
  });
  it("nom de fichier", () => {
    expect(nomFichierUnites("csv")).toBe("unites-stock.csv");
    expect(nomFichierUnites("xlsx")).toBe("unites-stock.xlsx");
  });
});
