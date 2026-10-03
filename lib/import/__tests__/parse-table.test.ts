import { describe, it, expect, vi } from "vitest";

// "server-only" throws unconditionally outside of Next.js's server
// bundle (see node_modules/server-only) — stub it so this file's own
// module-level import doesn't blow up under plain Vitest.
vi.mock("server-only", () => ({}));

import ExcelJS from "exceljs";
import { parseTableFile } from "../parse-table";

async function fileFromWorkbook(wb: ExcelJS.Workbook, name: string): Promise<File> {
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer as ArrayBuffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseTableFile", () => {
  it("reads an Excel file with French column headers", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Vehicules");
    ws.addRow(["Immatriculation", "Type", "Capacité réservoir", "Kilométrage", "Service"]);
    ws.addRow(["AB-123-CD", "PL", 500, 125000, "DPD"]);
    ws.addRow(["EF-456-GH", "SPL", 800, 98000, "Chronopost"]);

    const rows = await parseTableFile(await fileFromWorkbook(wb, "vehicules.xlsx"));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      Immatriculation: "AB-123-CD",
      Type: "PL",
      "Capacité réservoir": "500",
      "Kilométrage": "125000",
      Service: "DPD",
    });
  });

  it("skips fully empty rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Vehicules");
    ws.addRow(["registration", "type"]);
    ws.addRow(["AB-123-CD", "PL"]);
    ws.addRow([]); // a blank row someone left in the spreadsheet
    ws.addRow(["EF-456-GH", "SPL"]);

    const rows = await parseTableFile(await fileFromWorkbook(wb, "vehicules.xlsx"));
    expect(rows).toHaveLength(2);
  });

  it("reads a CSV file", async () => {
    const csv = "registration,type,service\nAB-123-CD,PL,DPD\n";
    const file = new File([csv], "vehicules.csv", { type: "text/csv" });
    const rows = await parseTableFile(file);
    expect(rows).toEqual([{ registration: "AB-123-CD", type: "PL", service: "DPD" }]);
  });

  it("rejects an unsupported format", async () => {
    const file = new File(["hello"], "vehicules.docx");
    await expect(parseTableFile(file)).rejects.toThrow(/Format non supporté/);
  });

  it("skips a leading instructions sheet and reads the real data sheet", async () => {
    const wb = new ExcelJS.Workbook();
    const instructions = wb.addWorksheet("Comment remplir");
    instructions.addRow([]);
    instructions.addRow([null, null, "Comment bien remplir ce fichier ?"]);
    instructions.addRow([null, null, "Suivez les instructions ci-dessous."]);

    const data = wb.addWorksheet("EXCEL entreprise");
    data.addRow(["Prénom (obligatoire)", "Nom (obligatoire)", "Email*(obligatoire)"]);
    data.addRow(["Valentin", "ANGLES", "valentin@example.com"]);
    data.addRow(["Théo", "BOITEL", "theo@example.com"]);

    const rows = await parseTableFile(await fileFromWorkbook(wb, "employes.xlsx"));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ "Prénom (obligatoire)": "Valentin", "Nom (obligatoire)": "ANGLES" });
  });
});
