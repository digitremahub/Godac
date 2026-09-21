import "server-only";
import Papa from "papaparse";
import ExcelJS from "exceljs";

/**
 * Turns an uploaded CSV/Excel file into plain {header: value} rows —
 * the shared shape lib/utils/csv.ts's validateRows() expects,
 * regardless of which format produced it. Runs server-side (unlike the
 * old client-only Papaparse-based import) because Excel needs a
 * Node-only library; keeping CSV here too means one code path for
 * both formats.
 *
 * PDF was tried and dropped: pdf-parse pulls in pdfjs-dist, which
 * references the browser-only `DOMMatrix` global at module load time
 * — it crashes the entire route (including the CSV/Excel branches
 * below, since the import itself throws before any request is
 * handled) the moment it's imported into a Vercel serverless
 * function, with no reasonable polyfill available server-side.
 */
export async function parseTableFile(file: File): Promise<Record<string, string>[]> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return parseCsvBuffer(buffer);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseExcelBuffer(buffer);
  }
  throw new Error("Format non supporté — utilisez un fichier CSV ou Excel (.xlsx).");
}

function parseCsvBuffer(buffer: Buffer): Record<string, string>[] {
  const parsed = Papa.parse<Record<string, string>>(buffer.toString("utf-8"), {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join("");
    }
    return "";
  }
  return String(value).trim();
}

async function parseExcelBuffer(buffer: Buffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Ce fichier Excel ne contient aucune feuille.");

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cellToString(cell.value);
  });

  const rows: Record<string, string>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (!header) return;
      const value = cellToString(cell.value);
      if (value) hasValue = true;
      record[header] = value;
    });
    if (hasValue) rows.push(record);
  });

  return rows;
}

