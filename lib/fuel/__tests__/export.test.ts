import { describe, expect, it } from "vitest";
import {
  EXPORT_MAX_PLEINS,
  TAUX_TVA_CARBURANT,
  avertissementTroncature,
  csvPleins,
  justificatifExport,
  lignePleinExport,
  lireFiltresExportPleins,
  nomFichierPleins,
  perimetreExportPleins,
  statutsDuFiltre,
  totauxParProduit,
  totauxPleins,
  ventilerTva,
  type PleinBrut,
} from "../export";

const brut = (o: Partial<PleinBrut> = {}): PleinBrut => ({
  occurred_at: "2026-10-10T07:30:00Z",
  liters: 100,
  unit_price: 1.5,
  total_amount: 120,
  vehicle_km: 125430,
  product: "gazole",
  status: "validated",
  station_name: "Total Lyon",
  tank_id: null,
  ticket_photo_path: "o/p/ticket.jpg",
  vehicule: "AB-123-CD",
  chauffeur: "Jean Dupont",
  cuve: null,
  ...o,
});

describe("périmètre par rôle", () => {
  it("comptable, direction, exploitation : organisation ; manager : son service ; chauffeur : aucun export", () => {
    expect(perimetreExportPleins("comptable")).toBe("organisation");
    expect(perimetreExportPleins("direction")).toBe("organisation");
    expect(perimetreExportPleins("exploitation")).toBe("organisation");
    expect(perimetreExportPleins("manager")).toBe("service");
    expect(perimetreExportPleins("chauffeur")).toBeNull();
  });
});

describe("filtres", () => {
  const aujourdhui = "2026-10-27";
  it("par défaut : le mois en cours jusqu'à aujourd'hui, pleins enregistrés", () => {
    expect(lireFiltresExportPleins({}, aujourdhui)).toEqual({ du: "2026-10-01", au: "2026-10-27", vehicule: null, chauffeur: null, statut: "enregistres" });
  });
  it("période inversée remise dans l'ordre, valeurs invalides ignorées", () => {
    const f = lireFiltresExportPleins({ du: "2026-10-20", au: "2026-10-05", vehicule: "pas-un-uuid", chauffeur: "11111111-1111-1111-1111-111111111111", statut: "n'importe quoi" }, aujourdhui);
    expect(f).toMatchObject({ du: "2026-10-05", au: "2026-10-20", vehicule: null, chauffeur: "11111111-1111-1111-1111-111111111111", statut: "enregistres" });
    expect(lireFiltresExportPleins({ du: "demain" }, aujourdhui).du).toBe("2026-10-01");
  });
  it("statuts lus par filtre", () => {
    expect(statutsDuFiltre("enregistres")).toEqual(["manual", "validated"]);
    expect(statutsDuFiltre("tous")).toBeNull();
    expect(statutsDuFiltre("ocr_failed")).toEqual(["ocr_failed"]);
  });
});

describe("TVA et totaux", () => {
  it("HT et TVA déduits du TTC (20 %)", () => {
    expect(TAUX_TVA_CARBURANT).toBe(0.2);
    expect(ventilerTva(120)).toEqual({ ht: 100, tva: 20 });
    expect(ventilerTva(100)).toEqual({ ht: 83.33, tva: 16.67 });
  });
  it("une ligne par plein : date et heure de Paris, origine, justificatif", () => {
    const l = lignePleinExport(brut());
    expect(l).toMatchObject({ date: "2026-10-10", heure: "09:30", vehicule: "AB-123-CD", chauffeur: "Jean Dupont", produit: "Gazole", origine: "Station Total Lyon", litres: 100, ttc: 120, ht: 100, tva: 20, km: 125430, statut: "Ticket validé", justificatif: "Photo du ticket" });
    expect(lignePleinExport(brut({ tank_id: "t", cuve: "Cuve nord" })).origine).toBe("Cuve Cuve nord");
    expect(lignePleinExport(brut({ product: "adblue" })).produit).toBe("AdBlue");
    expect(lignePleinExport(brut({ total_amount: null })).ttc).toBeNull();
  });
  it("justificatif : photo, relevé, facture ou aucun", () => {
    expect(justificatifExport({ ticket_photo_path: null, ticpe_justificatif: "releve_carte" })).toBe("Relevé de carte");
    expect(justificatifExport({ ticket_photo_path: null, ticpe_justificatif: "facture" })).toBe("Facture");
    expect(justificatifExport({ ticket_photo_path: null })).toBe("Aucun");
  });
  it("totaux : litres, TTC, HT, TVA, et par produit", () => {
    const lignes = [lignePleinExport(brut()), lignePleinExport(brut({ liters: 50, total_amount: 60 })), lignePleinExport(brut({ product: "adblue", liters: 10, total_amount: 12 }))];
    expect(totauxPleins(lignes)).toEqual({ nombre: 3, litres: 160, ttc: 192, ht: 160, tva: 32 });
    expect(totauxParProduit(lignes).map((p) => [p.produit, p.totaux.litres])).toEqual([["AdBlue", 10], ["Gazole", 150]]);
  });
});

describe("CSV comptable", () => {
  const lignes = [lignePleinExport(brut()), lignePleinExport(brut({ chauffeur: "=HYPERLINK(\"http://x\")", occurred_at: "2026-10-11T07:30:00Z" }))];
  const csv = csvPleins(lignes);

  it("UTF-8 avec BOM, séparateur « ; », fins de ligne CRLF, décimales à la virgule", () => {
    expect(csv.startsWith("﻿Date;Heure;Véhicule")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n/);
    expect(csv.split("\r\n")[1]).toContain(";100,00;1,50;120,00;100,00;20,00;125430,00;");
  });
  it("neutralise l'injection de formule dans une cellule texte", () => {
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.split("\r\n").some((l) => l.includes(";=HYPERLINK"))).toBe(false);
  });
  it("ligne de totaux et mention de TVA", () => {
    expect(csv).toContain("TOTAL;;;;;2 pleins;200,00;;240,00;200,00;40,00");
    expect(csv).toContain("TVA déduits au taux de 20 %");
  });
  it("un total par produit seulement s'il y en a plusieurs", () => {
    expect(csv).not.toContain("Total Gazole");
    expect(csvPleins([lignePleinExport(brut()), lignePleinExport(brut({ product: "adblue" }))])).toContain("Total AdBlue");
  });
  it("avertit en fin de fichier quand l'export est tronqué", () => {
    expect(csv).not.toContain("tronqué");
    const tronque = csvPleins(lignes, { tronque: true });
    expect(tronque).toContain(avertissementTroncature());
    expect(avertissementTroncature()).toContain(EXPORT_MAX_PLEINS.toLocaleString("fr-FR"));
  });
  it("nom de fichier", () => {
    expect(nomFichierPleins("2026-10-01", "2026-10-27", "xlsx")).toBe("pleins-2026-10-01-2026-10-27.xlsx");
  });
});
