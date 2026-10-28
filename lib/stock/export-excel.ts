import "server-only";
import ExcelJS from "exceljs";
import { ENTETE_EXPORT_UNITES, EXPORT_MAX_UNITES, cellulesUnite, type UniteExport } from "@/lib/stock/unites";
import { ENTETE_EXPORT_STOCK, EXPORT_MAX_MOUVEMENTS, cellulesHistorique, type FiltresHistorique, type LigneHistorique } from "@/lib/stock/historique";

/** Classeur Excel de l'historique : une feuille « Mouvements » et une feuille « Synthèse » (filtres, totaux par type). */
export async function classeurMouvements(params: { organisation: string; filtres: FiltresHistorique; lignes: readonly LigneHistorique[]; tronque: boolean }): Promise<Buffer> {
  const { organisation, filtres, lignes, tronque } = params;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GODAC";
  wb.created = new Date();

  const feuille = wb.addWorksheet("Mouvements");
  feuille.addRow([...ENTETE_EXPORT_STOCK]).font = { bold: true };
  for (const l of lignes) feuille.addRow(cellulesHistorique(l));
  feuille.getColumn(5).numFmt = "#,##0.###";
  feuille.columns.forEach((c) => {
    c.width = 18;
  });
  feuille.views = [{ state: "frozen", ySplit: 1 }];

  const synthese = wb.addWorksheet("Synthèse");
  synthese.addRow([`Historique des mouvements de stock — ${organisation}`]).font = { bold: true };
  synthese.addRow([`Période : du ${filtres.du ?? "début"} au ${filtres.au ?? "aujourd'hui"} (jours de Paris)`]);
  synthese.addRow([`Type : ${filtres.type ?? "tous"} · recherche : ${filtres.q ?? "aucune"}`]);
  synthese.addRow(["Le registre des mouvements est conservé sans modification possible."]);
  if (tronque) synthese.addRow([`Export tronqué à ${EXPORT_MAX_MOUVEMENTS} lignes : affinez la période.`]).font = { bold: true };
  synthese.addRow([]);
  synthese.addRow(["Mouvement", "Nombre"]).font = { bold: true };
  const parType = new Map<string, number>();
  for (const l of lignes) parType.set(l.libelleType, (parType.get(l.libelleType) ?? 0) + 1);
  for (const [type, n] of parType) synthese.addRow([type, n]);
  synthese.addRow(["TOTAL", lignes.length]).font = { bold: true };
  synthese.columns.forEach((c) => {
    c.width = 28;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Classeur Excel des unités : une feuille « Unités » (codes, attributs, statut, emplacement). */
export async function classeurUnites(params: { organisation: string; lignes: readonly UniteExport[]; tronque: boolean }): Promise<Buffer> {
  const { organisation, lignes, tronque } = params;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GODAC";
  wb.created = new Date();
  const feuille = wb.addWorksheet("Unités");
  feuille.addRow([...ENTETE_EXPORT_UNITES]).font = { bold: true };
  for (const u of lignes) feuille.addRow(cellulesUnite(u));
  // Les codes restent du texte (un code à zéros en tête ne doit pas devenir un nombre).
  for (const c of [1, 2, 15]) feuille.getColumn(c).numFmt = "@";
  feuille.columns.forEach((c) => {
    c.width = 18;
  });
  feuille.views = [{ state: "frozen", ySplit: 1 }];
  const note = wb.addWorksheet("Informations");
  note.addRow([`Unités de stock — ${organisation}`]).font = { bold: true };
  note.addRow(["Le code principal est celui qui est arrivé avec l'unité (code transporteur, client, SSCC) ; le code interne est un code complémentaire de l'entreprise."]);
  note.addRow(["Suivi logistique : le respect des exigences réglementaires du secteur reste à la charge de l'entreprise."]);
  if (tronque) note.addRow([`Export tronqué à ${EXPORT_MAX_UNITES} lignes : affinez la recherche.`]).font = { bold: true };
  note.columns.forEach((c) => {
    c.width = 90;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
