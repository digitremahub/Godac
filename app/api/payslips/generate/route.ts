import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { buildPayslip, PayslipBuildError } from "@/lib/payslips/build-payslip";

const bodySchema = z.object({
  user_id: z.string().uuid(),
  period_start: z.string().date(),
  period_end: z.string().date(),
  meal_vouchers_amount: z.coerce.number().nonnegative().optional(),
  bonus_amount: z.coerce.number().nonnegative().optional(),
});

/**
 * Builds one PDF from the salary already on file (user_contracts —
 * the same numbers direction enters on /payroll) and stores it in the
 * pre-existing `payslips` bucket/table (RLS already scoped "own or
 * direction", see 20260101000081-era scaffolding never wired to a
 * page until now). No cotisation engine, no DSN — an indicative
 * document only, see the disclaimer baked into the PDF itself.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const payslipsEnabled = await isModuleEnabled(supabase, appUser.organization_id, "payslips");
  if (!payslipsEnabled) {
    return NextResponse.json({ error: "Module Fiches de Paie non activé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const mealVouchersAmount = parsed.data.meal_vouchers_amount ?? 0;
  const bonusAmount = parsed.data.bonus_amount ?? 0;

  let pdfBytes: Buffer;
  let grossAmount: number;
  let netAmount: number;
  try {
    ({ pdfBytes, grossAmount, netAmount } = await buildPayslip({
      supabase,
      organizationId: appUser.organization_id,
      userId: parsed.data.user_id,
      periodStart: parsed.data.period_start,
      periodEnd: parsed.data.period_end,
      mealVouchersAmount,
      bonusAmount,
    }));
  } catch (e) {
    if (e instanceof PayslipBuildError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const filePath = `${appUser.organization_id}/${parsed.data.user_id}/${randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage.from("payslips").upload(filePath, pdfBytes, { contentType: "application/pdf" });
  if (uploadError) return NextResponse.json({ error: `Échec de l'envoi: ${uploadError.message}` }, { status: 500 });

  const { error: insertError } = await supabase.from("payslips").insert({
    organization_id: appUser.organization_id,
    user_id: parsed.data.user_id,
    period_start: parsed.data.period_start,
    period_end: parsed.data.period_end,
    gross_amount: grossAmount,
    net_amount: netAmount,
    meal_vouchers_amount: mealVouchersAmount,
    bonus_amount: bonusAmount,
    file_path: filePath,
    status: "generated",
    generated_by: appUser.id,
  });
  if (insertError) {
    // The generated PDF is now orphaned in storage (not wasted — the
    // unique (user_id, period_start, period_end) constraint firing
    // here means direction/une génération groupée a déjà traité ce
    // chauffeur pour cette période entre temps) but there's no row to
    // delete it from; good enough compared to blocking on a cleanup
    // that itself could fail. A payslip already on file in this state
    // is exactly what app/api/payslips/[id]/regenerate is for.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "Une fiche de paie existe déjà pour ce chauffeur sur cette période." }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
