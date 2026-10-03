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

/**
 * Many exports (HR tools especially) ship a first "read me" tab full
 * of instructions before the actual data tab — reading worksheets[0]
 * unconditionally would parse that prose as if it were the header/data
 * rows. Picking the sheet with the most rows that look tabular (2+
 * filled cells) instead of always the first one handles that without
 * needing to know anything about the file's origin.
 */
function pickDataWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | undefined {
  let best: ExcelJS.Worksheet | undefined;
  let bestScore = -1;
  for (const ws of workbook.worksheets) {
    let denseRows = 0;
    ws.eachRow((row) => {
      let nonEmpty = 0;
      row.eachCell({ includeEmpty: false }, () => {
        nonEmpty += 1;
      });
      if (nonEmpty >= 2) denseRows += 1;
    });
    if (denseRows > bestScore) {
      bestScore = denseRows;
      best = ws;
    }
  }
  return best;
}

async function parseExcelBuffer(buffer: Buffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = pickDataWorksheet(workbook);
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
 * A raw text dump of every sheet/row/cell, with none of parseTableFile's
 * assumptions (best-guess sheet, row 1 = header) — used to hand the AI
 * fallback (lib/import/ai-extract.ts) the full picture when a layout
 * the deterministic parser can't handle (a pivoted table, several
 * mini-tables side by side, ...) makes it come back empty.
 */
export async function dumpRawTableText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return buffer.toString("utf-8");
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const parts: string[] = [];
    for (const ws of workbook.worksheets) {
      parts.push(`=== Feuille: ${ws.name} ===`);
      ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cellToString(cell.value));
        });
        parts.push(`L${rowNumber}\t${cells.join("\t")}`);
      });
    }
    return parts.join("\n");
  }
  throw new Error("Format non supporté — utilisez un fichier CSV ou Excel (.xlsx).");
}

