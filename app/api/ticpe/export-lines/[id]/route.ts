import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { generateTicpePdf } from "@/lib/ticpe/generate-pdf";
import { buildTicpeWorkbook } from "@/lib/utils/excel";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({
    action: z.literal("correct"),
    corrected_total_liters: z.coerce.number().positive("Indiquez un litrage supérieur à 0."),
    corrected_total_amount: z.coerce.number().positive("Indiquez un montant supérieur à 0."),
  }),
]);

const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Exploitation/comptable ticks a TICPE export line off as correct, or
 * types a correction — either way the export's stored PDF is
 * regenerated in place right after, so the download link always
 * reflects the latest reviewed figures rather than the raw computed
 * ones. RLS ("ticpe_export_lines: comptable/direction review")
 * enforces who may do this; the role check here just gives an
 * immediate, clear error instead of a bare RLS failure.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (!["comptable", "direction"].includes(appUser.role)) {
    return NextResponse.json({ error: "Rôle non autorisé pour la vérification TICPE." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: line } = await supabase.from("ticpe_export_lines").select("id, export_id").eq("id", id).maybeSingle();
  if (!line) return NextResponse.json({ error: "Ligne introuvable." }, { status: 404 });

  const update =
    parsed.data.action === "confirm"
      ? { status: "confirmed" as const, corrected_total_liters: null, corrected_total_amount: null }
      : {
          status: "corrected" as const,
          corrected_total_liters: parsed.data.corrected_total_liters,
          corrected_total_amount: parsed.data.corrected_total_amount,
        };

  const { error } = await supabase
    .from("ticpe_export_lines")
    .update({ ...update, reviewed_by: appUser.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [{ data: exportRow }, { data: organization }, { data: allLines }] = await Promise.all([
    supabase.from("ticpe_exports").select("organization_id, period_start, period_end, file_path, pdf_file_path").eq("id", line.export_id).single(),
    supabase.from("organizations").select("name").eq("id", appUser.organization_id).single(),
    supabase
      .from("ticpe_export_lines")
      .select("registration, vehicle_type, entry_count, computed_total_liters, computed_total_amount, corrected_total_liters, corrected_total_amount, vehicles(ptac_kg)")
      .eq("export_id", line.export_id)
      .order("registration"),
  ]);
  if (!exportRow) return NextResponse.json({ error: "Export introuvable." }, { status: 404 });

  const pdfBuffer = await generateTicpePdf({
    organizationName: organization?.name ?? "Organisation",
    periodStartLabel: DAY_LABEL.format(new Date(`${exportRow.period_start}T12:00:00Z`)),
    periodEndLabel: DAY_LABEL.format(new Date(`${exportRow.period_end}T12:00:00Z`)),
    lines: (allLines ?? []).map((l) => ({
      registration: l.registration,
      vehicleType: l.vehicle_type,
      entryCount: l.entry_count,
      totalLiters: l.corrected_total_liters ?? l.computed_total_liters,
      totalAmount: l.corrected_total_amount ?? l.computed_total_amount,
      corrected: l.corrected_total_liters !== null,
    })),
  });

  const pdfFilePath = exportRow.pdf_file_path ?? `${exportRow.organization_id}/${line.export_id}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("ticpe-exports")
    .upload(pdfFilePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
  if (uploadError) return NextResponse.json({ error: `Échec de la régénération du PDF: ${uploadError.message}` }, { status: 500 });

  // L'Excel et le total de l'export suivent les corrections, comme le PDF.
  const lignes = (allLines ?? []).map((l: any) => ({
    registration: l.registration as string,
    vehicleType: l.vehicle_type as "PL" | "SPL",
    ptacKg: l.vehicles?.ptac_kg !== null && l.vehicles?.ptac_kg !== undefined ? Number(l.vehicles.ptac_kg) : null,
    entryCount: l.entry_count as number,
    totalLiters: Number(l.corrected_total_liters ?? l.computed_total_liters),
    totalAmount: Number(l.corrected_total_amount ?? l.computed_total_amount),
  }));
  const workbook = await buildTicpeWorkbook({
    organizationName: organization?.name ?? "Organisation",
    periodStart: exportRow.period_start,
    periodEnd: exportRow.period_end,
    rows: lignes,
  });
  if (exportRow.file_path) {
    const { error: xlsxError } = await supabase.storage.from("ticpe-exports").upload(exportRow.file_path, workbook, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
    if (xlsxError) return NextResponse.json({ error: `Échec de la régénération de l'Excel: ${xlsxError.message}` }, { status: 500 });
  }

  const totalLiters = Math.round(lignes.reduce((n, l) => n + l.totalLiters, 0) * 100) / 100;
  await supabase
    .from("ticpe_exports")
    .update({ total_liters: totalLiters, ...(exportRow.pdf_file_path ? {} : { pdf_file_path: pdfFilePath }) })
    .eq("id", line.export_id);

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "ticpe_correction",
    targetTable: "ticpe_export_lines",
    targetId: id,
    details: parsed.data,
  });
  return NextResponse.json({ ok: true });
}
