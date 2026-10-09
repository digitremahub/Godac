import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { generatePayslipPdf } from "@/lib/payslips/generate-pdf";

const bodySchema = z.object({
  user_id: z.string().uuid(),
  period_start: z.string().date(),
  period_end: z.string().date(),
});

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

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

  const [{ data: employee }, { data: contract }, { data: organization }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, role_title")
      .eq("id", parsed.data.user_id)
      .eq("organization_id", appUser.organization_id)
      .single(),
    supabase.from("user_contracts").select("monthly_gross_salary, monthly_net_salary").eq("user_id", parsed.data.user_id).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", appUser.organization_id).single(),
  ]);

  if (!employee) return NextResponse.json({ error: "Employé introuvable." }, { status: 404 });
  if (!contract?.monthly_gross_salary || !contract?.monthly_net_salary) {
    return NextResponse.json({ error: "Salaire brut/net non renseigné pour cet employé (voir /payroll)." }, { status: 422 });
  }

  const periodStart = new Date(parsed.data.period_start);
  const pdfBytes = await generatePayslipPdf({
    organizationName: organization?.name ?? "Organisation",
    employeeName: employee.full_name,
    employeeRoleTitle: employee.role_title,
    periodLabel: MONTH_LABEL.format(periodStart),
    periodStartLabel: DAY_LABEL.format(new Date(parsed.data.period_start)),
    periodEndLabel: DAY_LABEL.format(new Date(parsed.data.period_end)),
    grossSalary: Number(contract.monthly_gross_salary),
    netSalary: Number(contract.monthly_net_salary),
  });

  const filePath = `${appUser.organization_id}/${parsed.data.user_id}/${randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage.from("payslips").upload(filePath, pdfBytes, { contentType: "application/pdf" });
  if (uploadError) return NextResponse.json({ error: `Échec de l'envoi: ${uploadError.message}` }, { status: 500 });

  const { error: insertError } = await supabase.from("payslips").insert({
    organization_id: appUser.organization_id,
    user_id: parsed.data.user_id,
    period_start: parsed.data.period_start,
    period_end: parsed.data.period_end,
    gross_amount: contract.monthly_gross_salary,
    net_amount: contract.monthly_net_salary,
    file_path: filePath,
    status: "generated",
    generated_by: appUser.id,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
