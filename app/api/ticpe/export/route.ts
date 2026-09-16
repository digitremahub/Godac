import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { filterTicpeEligibleVehicles } from "@/lib/business/ticpe";
import { buildTicpeWorkbook } from "@/lib/utils/excel";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
});

/**
 * Module 7: generates the TICPE export, strictly scoped to PL/SPL
 * (see lib/business/ticpe.ts — VL never appears here, by construction
 * rather than by a filter someone could forget to apply). Only
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

  const { data: entries, error } = await supabase
    .from("fuel_entries")
    .select("liters, unit_price, total_amount, vehicles!inner(registration, type)")
    .in("status", ["manual", "validated"]) // only trusted, validated data feeds a fiscal export
    .gte("occurred_at", `${period_start}T00:00:00Z`)
    .lte("occurred_at", `${period_end}T23:59:59Z`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const eligibleEntries = filterTicpeEligibleVehicles(
    (entries ?? []).map((e: any) => ({ ...e, type: e.vehicles.type })),
  );

  const byVehicle = new Map<
    string,
    { registration: string; vehicleType: "PL" | "SPL"; entryCount: number; totalLiters: number; totalAmount: number }
  >();

  for (const entry of eligibleEntries as any[]) {
    const key = entry.vehicles.registration;
    const existing = byVehicle.get(key) ?? {
      registration: entry.vehicles.registration,
      vehicleType: entry.vehicles.type,
      entryCount: 0,
      totalLiters: 0,
      totalAmount: 0,
    };
    existing.entryCount += 1;
    existing.totalLiters += Number(entry.liters ?? 0);
    existing.totalAmount += Number(entry.total_amount ?? 0);
    byVehicle.set(key, existing);
  }

  const rows = Array.from(byVehicle.values()).sort((a, b) => a.registration.localeCompare(b.registration));

  const workbookBuffer = await buildTicpeWorkbook({
    organizationName: organization.name,
    periodStart: period_start,
    periodEnd: period_end,
    rows,
  });

  const exportId = randomUUID();
  const filePath = `${organization.id}/${exportId}.xlsx`;

  const { error: uploadError } = await supabase.storage
    .from("ticpe-exports")
    .upload(filePath, workbookBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  if (uploadError) {
    return NextResponse.json({ error: `Échec de l'upload: ${uploadError.message}` }, { status: 500 });
  }

  const totalLiters = rows.reduce((sum, r) => sum + r.totalLiters, 0);

  const { data: exportRow, error: insertError } = await supabase
    .from("ticpe_exports")
    .insert({
      organization_id: organization.id,
      period_start,
      period_end,
      generated_by: appUser.id,
      file_path: filePath,
      vehicle_count: rows.length,
      total_liters: totalLiters,
    })
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { data: signedUrl } = await supabase.storage.from("ticpe-exports").createSignedUrl(filePath, 300);

  return NextResponse.json({ exportId: exportRow.id, downloadUrl: signedUrl?.signedUrl });
}
