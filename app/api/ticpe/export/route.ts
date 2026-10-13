import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { bornesPeriode, eligibiliteTicpe } from "@/lib/ticpe/export";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildTicpeWorkbook } from "@/lib/utils/excel";
import { generateTicpePdf } from "@/lib/ticpe/generate-pdf";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z
  .object({
    period_start: z.string().date(),
    period_end: z.string().date(),
  })
  .refine((b) => b.period_start <= b.period_end, { message: "La fin de période précède le début.", path: ["period_end"] });

const PAGE = 1000;

/**
 * Module 7: generates the TICPE export — gazole uniquement (jamais
 * d'AdBlue), pleins validés, véhicules PL/SPL de PTAC ≥ 7,5 t (ou PTAC non
 * renseigné, signalé dans l'Excel), motorisation non essence/électrique
 * (lib/ticpe/export.ts). Période en jours entiers, heure de Paris. Only
 * comptable/direction can reach this route in practice (RLS on
 * `ticpe_exports` would reject the insert otherwise), but we also
 * check the role up front so the error is immediate and clear.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (!["comptable", "direction"].includes(appUser.role)) {
    return NextResponse.json({ error: "Rôle non autorisé pour l'export TICPE" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { period_start, period_end } = parsed.data;

  const supabase = await createServerSupabaseClient();
  const ticpeEnabled = await isModuleEnabled(supabase, appUser.organization_id, "ticpe_export");
  if (!ticpeEnabled) {
    return NextResponse.json({ error: "Module Export TICPE non activé pour votre organisation" }, { status: 403 });
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", appUser.organization_id)
    .single();
  if (!organization) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
  }

  // Période en jours entiers, heure de Paris : [début 00:00, lendemain de la fin 00:00[.
  const { depuis, avant } = bornesPeriode(period_start, period_end);
  const entries: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("fuel_entries")
      .select("id, liters, total_amount, vehicles!inner(id, registration, type, spec_sources, ptac_kg, fuel_type)")
      .eq("organization_id", organization.id)
      .in("status", ["manual", "validated"]) // only trusted, validated data feeds a fiscal export
      .eq("product", "gazole") // jamais d'AdBlue dans une déclaration de gazole
      .gte("occurred_at", depuis)
      .lt("occurred_at", avant)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    entries.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const byVehicle = new Map<
    string,
    { vehicleId: string; registration: string; vehicleType: "PL" | "SPL"; ptacKg: number | null; entryCount: number; totalLiters: number; totalAmount: number }
  >();

  for (const entry of entries) {
    const v = entry.vehicles;
    if (!eligibiliteTicpe(v).inclus) continue;
    const key = v.id;
    const existing = byVehicle.get(key) ?? {
      vehicleId: v.id,
      registration: v.registration,
      vehicleType: v.type,
      ptacKg: v.ptac_kg !== null && v.ptac_kg !== undefined ? Number(v.ptac_kg) : null,
      entryCount: 0,
      totalLiters: 0,
      totalAmount: 0,
    };
    existing.entryCount += 1;
    existing.totalLiters += Number(entry.liters ?? 0);
    existing.totalAmount += Number(entry.total_amount ?? 0);
    byVehicle.set(key, existing);
  }

  const rows = Array.from(byVehicle.values())
    .map((r) => ({ ...r, totalLiters: Math.round(r.totalLiters * 100) / 100, totalAmount: Math.round(r.totalAmount * 100) / 100 }))
    .sort((a, b) => a.registration.localeCompare(b.registration, "fr"));

  const workbookBuffer = await buildTicpeWorkbook({
    organizationName: organization.name,
    periodStart: period_start,
    periodEnd: period_end,
    rows,
  });

  const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const pdfBuffer = await generateTicpePdf({
    organizationName: organization.name,
    periodStartLabel: DAY_LABEL.format(new Date(`${period_start}T12:00:00Z`)),
    periodEndLabel: DAY_LABEL.format(new Date(`${period_end}T12:00:00Z`)),
    lines: rows.map((r) => ({
      registration: r.registration,
      vehicleType: r.vehicleType,
      entryCount: r.entryCount,
      totalLiters: r.totalLiters,
      totalAmount: r.totalAmount,
      corrected: false,
    })),
  });

  const exportId = randomUUID();
  const filePath = `${organization.id}/${exportId}.xlsx`;
  const pdfFilePath = `${organization.id}/${exportId}.pdf`;

  const [{ error: uploadError }, { error: pdfUploadError }] = await Promise.all([
    supabase.storage.from("ticpe-exports").upload(filePath, workbookBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    supabase.storage.from("ticpe-exports").upload(pdfFilePath, pdfBuffer, { contentType: "application/pdf" }),
  ]);
  if (uploadError) {
    return NextResponse.json({ error: `Échec de l'upload: ${uploadError.message}` }, { status: 500 });
  }
  if (pdfUploadError) {
    return NextResponse.json({ error: `Échec de l'upload PDF: ${pdfUploadError.message}` }, { status: 500 });
  }

  const totalLiters = Math.round(rows.reduce((sum, r) => sum + r.totalLiters, 0) * 100) / 100;

  const { data: exportRow, error: insertError } = await supabase
    .from("ticpe_exports")
    .insert({
      organization_id: organization.id,
      period_start,
      period_end,
      generated_by: appUser.id,
      file_path: filePath,
      pdf_file_path: pdfFilePath,
      vehicle_count: rows.length,
      total_liters: totalLiters,
    })
    .select("id")
    .single();

  if (insertError) {
    await createAdminSupabaseClient().storage.from("ticpe-exports").remove([filePath, pdfFilePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Export tout-ou-rien : si les lignes ne s'enregistrent pas, l'export et ses fichiers sont retirés.
  const annuler = async () => {
    const admin = createAdminSupabaseClient();
    await admin.from("ticpe_exports").delete().eq("id", exportRow.id);
    await admin.storage.from("ticpe-exports").remove([filePath, pdfFilePath]);
  };

  if (rows.length > 0) {
    const { error: linesError } = await supabase.from("ticpe_export_lines").insert(
      rows.map((r) => ({
        export_id: exportRow.id,
        organization_id: organization.id,
        vehicle_id: r.vehicleId,
        registration: r.registration,
        vehicle_type: r.vehicleType,
        entry_count: r.entryCount,
        computed_total_liters: r.totalLiters,
        computed_total_amount: r.totalAmount,
      })),
    );
    if (linesError) {
      await annuler();
      return NextResponse.json({ error: `Export annulé : ${linesError.message}` }, { status: 500 });
    }
  }

  const { data: signedUrl } = await supabase.storage.from("ticpe-exports").createSignedUrl(filePath, 300);

  await journaliser({
    organizationId: organization.id,
    userId: appUser.id,
    action: "ticpe_export",
    targetTable: "ticpe_exports",
    targetId: exportRow.id,
    details: { period_start, period_end, vehicules: rows.length, litres: totalLiters },
  });
  return NextResponse.json({ exportId: exportRow.id, downloadUrl: signedUrl?.signedUrl });
}
