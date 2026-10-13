import "server-only";
import ExcelJS from "exceljs";

export interface TicpeExportRow {
  registration: string;
  vehicleType: "PL" | "SPL";
  /** PTAC en kg ; null = non renseigné (à vérifier avant dépôt). */
  ptacKg?: number | null;
  entryCount: number;
  totalLiters: number;
  totalAmount: number;
}

/**
 * Builds the TICPE export workbook (Module 7). Only ever receives
 * PL/SPL rows — the VL exclusion happens one layer up, in
 * lib/business/ticpe.ts via filterTicpeEligibleVehicles, so this
 * function has no VL/PL/SPL branching of its own to get wrong.
 */
export async function buildTicpeWorkbook({
  organizationName,
  periodStart,
  periodEnd,
  rows,
}: {
  organizationName: string;
  periodStart: string;
  periodEnd: string;
  rows: TicpeExportRow[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GODAC";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("TICPE");
  sheet.addRow([`Export TICPE — ${organizationName}`]);
  sheet.addRow([`Période: ${periodStart} au ${periodEnd}`]);
  sheet.addRow([`Périmètre : gazole uniquement (AdBlue exclu), pleins validés, véhicules PL/SPL de PTAC ≥ 7,5 t (VL exclus)`]);
  sheet.addRow([`Période en jours entiers, heure de Paris. Montant = coût d'achat enregistré (TTC), pas le montant du remboursement.`]);
  sheet.addRow([]);

  const header = sheet.addRow([
    "Immatriculation",
    "Type",
    "PTAC (kg)",
    "Nb ravitaillements",
    "Litres totaux",
    "Coût d'achat TTC (€)",
  ]);
  header.font = { bold: true };

  for (const row of rows) {
    sheet.addRow([
      row.registration,
      row.vehicleType,
      row.ptacKg ?? "non renseigné — à vérifier",
      row.entryCount,
      Number(row.totalLiters.toFixed(2)),
      Number(row.totalAmount.toFixed(2)),
    ]);
  }

  const totalsRow = sheet.addRow([
    "TOTAL",
    "",
    "",
    rows.reduce((sum, r) => sum + r.entryCount, 0),
    Number(rows.reduce((sum, r) => sum + r.totalLiters, 0).toFixed(2)),
    Number(rows.reduce((sum, r) => sum + r.totalAmount, 0).toFixed(2)),
  ]);
  totalsRow.font = { bold: true };

  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
