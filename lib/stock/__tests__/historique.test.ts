import { describe, expect, it } from "vitest";
import { csvMouvements, dateHeureParis, ligneHistorique, lireFiltresHistorique, nomFichierMouvements, type MouvementBrut } from "@/lib/stock/historique";

const brut = (p: Partial<MouvementBrut> = {}): MouvementBrut => ({
  id: "m1",
  created_at: "2026-10-28T13:05:00Z",
  type: "transfert",
  sens: 0,
  quantite: "3.000",
  unite_code: null,
  lot: "L1",
  dlc: "2027-01-31",
  statut_avant: null,
  statut_apres: null,
  motif: null,
  source: "app",
  auteur_nom: "Alice Martin",
  run_id: null,
  stop_id: null,
  article: { code: "R-1", nom: "Vis", unite: "pièce" },
  site: { nom: "Dépôt Nord" },
  src: { code: "Q1-01" },
  dest: [{ code: "Q1-02" }],
  ...p,
});

describe("filtres de l'historique", () => {
  it("valeurs invalides ignorées, recherche nettoyée", () => {
    const f = lireFiltresHistorique({ du: "2026-02-30", au: "2026-10-28", type: "inconnu", q: "  C%12_3,(x)  ", site: "pas-un-uuid", article: "11111111-1111-4111-8111-111111111111", page: "-4" });
    expect(f).toEqual({ du: null, au: "2026-10-28", type: null, q: "C 12 3 x", site: null, article: "11111111-1111-4111-8111-111111111111", tournee: null, page: 1 });
  });
  it("type valide et page lue", () => {
    expect(lireFiltresHistorique({ type: "casse", page: "3" })).toMatchObject({ type: "casse", page: 3 });
  });
});

describe("lignes de l'historique", () => {
  it("article : nom, quantité, dépôt, de / vers, origine saisie", () => {
    const l = ligneHistorique(brut());
    expect(l).toMatchObject({ date: "28/10/2026", heure: "14:05", libelleType: "Transfert", objet: "Vis (R-1)", quantite: 3, unite: "pièce", depot: "Dépôt Nord", de: "Q1-01", vers: "Q1-02", origine: "Saisie", tournee: false });
  });
  it("unité : code, changement de statut, lien tournée", () => {
    const l = ligneHistorique(brut({ type: "sortie", unite_code: "COLIS1", article: null, statut_avant: "dans_depot", statut_apres: "en_tournee", run_id: "r1", source: "tournee" }));
    expect(l).toMatchObject({ objet: "COLIS1", unite: "unité", statut: "En dépôt → En tournée", origine: "Tournée", tournee: true });
  });
  it("heure de Paris (heure d'hiver et d'été)", () => {
    expect(dateHeureParis("2026-01-15T23:30:00Z")).toEqual({ date: "16/01/2026", heure: "00:30" });
    expect(dateHeureParis("2026-07-15T22:30:00Z")).toEqual({ date: "16/07/2026", heure: "00:30" });
  });
});

describe("export CSV", () => {
  it("UTF-8 avec BOM, point-virgule, virgule décimale, formule neutralisée", () => {
    const csv = csvMouvements([ligneHistorique(brut({ motif: "=SOMME(A1)", quantite: 2.5 }))]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lignes = csv.split("\r\n");
    expect(lignes[0]).toBe("Date;Heure;Mouvement;Unité ou article;Quantité;Unité;Dépôt;De;Vers;Lot;DLC;Statut;Motif;Auteur;Origine;Liée à une tournée".replace(/^/, "﻿"));
    expect(lignes[1]).toContain("2,5");
    expect(lignes[1]).not.toContain(";=SOMME");
  });
  it("avertissement de troncature", () => {
    expect(csvMouvements([], { tronque: true })).toContain("Export tronqué");
  });
  it("nom de fichier", () => {
    expect(nomFichierMouvements("2026-10-01", "2026-10-28", "xlsx")).toBe("mouvements-stock-2026-10-01-2026-10-28.xlsx");
    expect(nomFichierMouvements(null, null, "csv")).toBe("mouvements-stock-debut-aujourdhui.csv");
  });
});
