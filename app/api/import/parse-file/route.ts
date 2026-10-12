import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { parseTableFile, dumpRawTableText } from "@/lib/import/parse-table";
import { extractRowsWithAI } from "@/lib/import/ai-extract";
import { validateRows, vehicleCsvRowSchema, driverCsvRowSchema } from "@/lib/utils/csv";

const SCHEMAS = { vehicles: vehicleCsvRowSchema, drivers: driverCsvRowSchema } as const;

/**
 * Shared file→rows extraction for every bulk-import entry point
 * (onboarding wizard, Flotte, Admin > Utilisateurs) — see
 * lib/utils/csv.ts's parseImportFile(), which posts here then
 * validates the returned rows against the vehicle/driver schema. Just
 * requires a signed-in user (not a specific role): both callers already
 * gate the actual import action, and parsing alone can't mutate
 * anything.
 *
 * Tries the deterministic header-row parser first (fast, free, no
 * external call) — most client files are a normal single-table export
 * and it handles those on its own. Only when that comes back with zero
 * valid rows (an unusual layout: a pivoted table, several mini-tables
 * side by side, headers it can't recognize, ...) does it fall back to
 * lib/import/ai-extract.ts, which reads the raw file content itself
 * rather than assuming any particular structure.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();

  const form = await req.formData();
  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }
  if (kind !== "vehicles" && kind !== "drivers") {
    return NextResponse.json({ error: "Type d'import manquant" }, { status: 400 });
  }

  let deterministicRows: Record<string, string>[] = [];
  let parseError: string | null = null;
  try {
    deterministicRows = await parseTableFile(file);
  } catch (e) {
    parseError = e instanceof Error ? e.message : "Fichier illisible";
  }

  const { rows: validRows } = validateRows(deterministicRows, SCHEMAS[kind]);
  if (validRows.length > 0) {
    return NextResponse.json({ rows: deterministicRows });
  }

  // The AI fallback reads the raw file (possibly employee data): only
  // when the organisation allows automatic reading.
  const supabase = await createServerSupabaseClient();
  if (await isModuleEnabled(supabase, appUser.organization_id, "ocr")) {
    try {
      const rawText = await dumpRawTableText(file);
      const aiResult = await extractRowsWithAI(rawText, kind);
      if (aiResult.ok && aiResult.rows.length > 0) {
        return NextResponse.json({ rows: aiResult.rows, source: "ai" });
      }
      if (!aiResult.ok) {
        console.error("AI import fallback unavailable:", aiResult.reason);
      }
    } catch (e) {
      console.error("AI import fallback failed", e);
    }
  }

  if (deterministicRows.length === 0 && parseError) {
    return NextResponse.json({ error: parseError }, { status: 400 });
  }
  return NextResponse.json({ rows: deterministicRows });
}
