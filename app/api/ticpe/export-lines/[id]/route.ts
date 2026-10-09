import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { generateTicpePdf } from "@/lib/ticpe/generate-pdf";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({
    action: z.literal("correct"),
    corrected_total_liters: z.coerce.number().min(0),
    corrected_total_amount: z.coerce.number().min(0),
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
    supabase.from("ticpe_exports").select("organization_id, period_start, period_end, pdf_file_path").eq("id", line.export_id).single(),
    supabase.from("organizations").select("name").eq("id", appUser.organization_id).single(),
    supabase
      .from("ticpe_export_lines")
      .select("registration, vehicle_type, entry_count, computed_total_liters, computed_total_amount, corrected_total_liters, corrected_total_amount")
      .eq("export_id", line.export_id)
      .order("registration"),
  ]);
  if (!exportRow) return NextResponse.json({ error: "Export introuvable." }, { status: 404 });

  const pdfBuffer = await generateTicpePdf({
    organizationName: organization?.name ?? "Organisation",
    periodStartLabel: DAY_LABEL.format(new Date(exportRow.period_start)),
    periodEndLabel: DAY_LABEL.format(new Date(exportRow.period_end)),
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

  if (!exportRow.pdf_file_path) {
    await supabase.from("ticpe_exports").update({ pdf_file_path: pdfFilePath }).eq("id", line.export_id);
  }

  return NextResponse.json({ ok: true });
}
