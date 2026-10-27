import "server-only";
import ExcelJS from "exceljs";
import { MENTION_INDICATIVE } from "@/lib/legal/mention-indicative";
import { ENTETE_PLEINS_EXPORT, avertissementTroncature, mentionTva, totauxParProduit, totauxPleins, type FiltresExportPleins, type LignePleinExport } from "@/lib/fuel/export";

/** Classeur Excel des pleins : une feuille « Pleins » (une ligne par plein, totaux en pied) et une feuille « Synthèse » (filtres, totaux par produit). */
export async function classeurPleins(params: { organisation: string; filtres: FiltresExportPleins; lignes: readonly LignePleinExport[]; tronque: boolean }): Promise<Buffer> {
  const { organisation, filtres, lignes, tronque } = params;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GODAC";
  wb.created = new Date();

  const feuille = wb.addWorksheet("Pleins");
  feuille.addRow([...ENTETE_PLEINS_EXPORT]).font = { bold: true };
  for (const l of lignes) feuille.addRow([l.date, l.heure, l.vehicule, l.chauffeur, l.produit, l.origine, l.litres, l.prixLitre, l.ttc, l.ht, l.tva, l.km, l.statut, l.justificatif]);
  const t = totauxPleins(lignes);
  feuille.addRow([]);
  feuille.addRow(["TOTAL", "", "", "", "", `${t.nombre} plein(s)`, t.litres, "", t.ttc, t.ht, t.tva]).font = { bold: true };
  feuille.getColumn(7).numFmt = "#,##0.00";
  for (const c of [8, 9, 10, 11]) feuille.getColumn(c).numFmt = "#,##0.00";
  feuille.columns.forEach((c) => {
    c.width = 18;
  });
  feuille.views = [{ state: "frozen", ySplit: 1 }];

  const synthese = wb.addWorksheet("Synthèse");
  synthese.addRow([`Export des pleins — ${organisation}`]).font = { bold: true };
  synthese.addRow([`Période : du ${filtres.du} au ${filtres.au} (jours de Paris)`]);
  synthese.addRow([`Statut : ${filtres.statut} · véhicule : ${filtres.vehicule ? "filtré" : "tous"} · chauffeur : ${filtres.chauffeur ? "filtré" : "tous"}`]);
  synthese.addRow([mentionTva()]);
  synthese.addRow([MENTION_INDICATIVE]);
  if (tronque) synthese.addRow([avertissementTroncature()]).font = { bold: true };
  synthese.addRow([]);
  synthese.addRow(["Produit", "Pleins", "Litres", "Montant TTC (€)", "Montant HT (€)", "TVA (€)"]).font = { bold: true };
  for (const p of totauxParProduit(lignes)) synthese.addRow([p.produit, p.totaux.nombre, p.totaux.litres, p.totaux.ttc, p.totaux.ht, p.totaux.tva]);
  synthese.addRow(["TOTAL", t.nombre, t.litres, t.ttc, t.ht, t.tva]).font = { bold: true };
  synthese.columns.forEach((c) => {
    c.width = 22;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
