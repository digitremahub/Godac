import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { parseTableFile } from "@/lib/import/parse-table";

/**
 * Shared file→rows extraction for every bulk-import entry point
 * (onboarding wizard, Admin > Import) — see lib/utils/csv.ts's
 * parseImportFile(), which posts here then validates the returned
 * rows against the vehicle/driver schema. Just requires a signed-in
 * user (not a specific role): both callers already gate the actual
 * import action, and parsing alone can't mutate anything.
 */
export async function POST(req: Request) {
  await requireAppUser();

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }

  try {
    const rows = await parseTableFile(file);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Fichier illisible" }, { status: 400 });
  }
}
