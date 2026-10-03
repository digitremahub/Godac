import "server-only";
import ExcelJS from "exceljs";

export interface TicpeExportRow {
  registration: string;
  vehicleType: "PL" | "SPL";
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
  sheet.addRow([`Périmètre: véhicules PL et SPL uniquement (VL exclus par règle métier)`]);
  sheet.addRow([]);

  const header = sheet.addRow([
    "Immatriculation",
    "Type",
    "Nb ravitaillements",
    "Litres totaux",
    "Montant total (€)",
  ]);
  header.font = { bold: true };

  for (const row of rows) {
    sheet.addRow([
      row.registration,
      row.vehicleType,
      row.entryCount,
      Number(row.totalLiters.toFixed(2)),
      Number(row.totalAmount.toFixed(2)),
    ]);
  }

  const totalsRow = sheet.addRow([
    "TOTAL",
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
