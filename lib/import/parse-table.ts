import "server-only";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";

/**
 * Turns an uploaded CSV/Excel/PDF file into plain {header: value} rows
 * — the shared shape lib/utils/csv.ts's validateRows() expects,
 * regardless of which format produced it. Runs server-side (unlike the
 * old client-only Papaparse-based import) because Excel and PDF need
 * Node-only libraries; keeping CSV here too means one code path for all
 * three formats.
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
  if (name.endsWith(".pdf")) {
    return parsePdfBuffer(buffer);
  }
  throw new Error("Format non supporté — utilisez un fichier CSV, Excel (.xlsx) ou PDF.");
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

/**
 * Best-effort: relies on pdf-parse's table detection, which works for
 * a real text-based table (an export from Excel/Word printed to PDF,
 * for instance) but not a scanned/image PDF (no text layer — would
 * need OCR) or a free-form layout with no clear column structure.
 */
async function parsePdfBuffer(buffer: Buffer): Promise<Record<string, string>[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getTable();
    const allTables = result.pages.flatMap((p) => p.tables ?? []);
    if (allTables.length === 0) {
      throw new Error(
        "Aucun tableau détecté dans ce PDF — utilisez un PDF avec un vrai tableau texte (pas une image scannée), ou passez par CSV/Excel.",
      );
    }

    const [headerRow, ...restOfFirstTable] = allTables[0]!;
    const header = (headerRow ?? []).map((h) => h.trim());
    const dataRows: string[][] = [...restOfFirstTable];

    for (const table of allTables.slice(1)) {
      const [firstRow, ...rest] = table;
      const isRepeatedHeader = firstRow?.every((cell, i) => cell.trim().toLowerCase() === header[i]?.toLowerCase());
      dataRows.push(...(isRepeatedHeader ? rest : table));
    }

    return dataRows
      .filter((row) => row.some((cell) => cell.trim() !== ""))
      .map((row) => Object.fromEntries(header.map((h, i) => [h, (row[i] ?? "").trim()])));
  } finally {
    await parser.destroy();
  }
}
