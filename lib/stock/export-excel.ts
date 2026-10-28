import "server-only";
import ExcelJS from "exceljs";
import { ENTETE_EXPORT_STOCK, EXPORT_MAX_MOUVEMENTS, type FiltresHistorique, type LigneHistorique } from "@/lib/stock/historique";

/** Classeur Excel de l'historique : une feuille « Mouvements » et une feuille « Synthèse » (filtres, totaux par type). */
export async function classeurMouvements(params: { organisation: string; filtres: FiltresHistorique; lignes: readonly LigneHistorique[]; tronque: boolean }): Promise<Buffer> {
  const { organisation, filtres, lignes, tronque } = params;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GODAC";
  wb.created = new Date();

  const feuille = wb.addWorksheet("Mouvements");
  feuille.addRow([...ENTETE_EXPORT_STOCK]).font = { bold: true };
  for (const l of lignes) feuille.addRow([l.date, l.heure, l.libelleType, l.objet, l.quantite, l.unite, l.depot, l.de, l.vers, l.lot, l.dlc, l.statut, l.motif, l.auteur, l.origine, l.tournee ? "oui" : "non"]);
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
