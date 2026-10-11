import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { generatePayslipPdf } from "@/lib/payslips/generate-pdf";
import { countWeekdays } from "@/lib/business/payroll";
import { addDays } from "@/lib/planning/dates";

const bodySchema = z.object({
  user_id: z.string().uuid(),
  period_start: z.string().date(),
  period_end: z.string().date(),
  meal_vouchers_amount: z.coerce.number().nonnegative().optional(),
  bonus_amount: z.coerce.number().nonnegative().optional(),
});

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const CONTRACT_TYPE_LABELS: Record<string, string> = { cdi: "CDI", cdd: "CDD", interim: "Intérim", apprentissage: "Apprentissage" };

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

  const timeClockEnabled = await isModuleEnabled(supabase, appUser.organization_id, "time_clock");
  const yearStart = `${parsed.data.period_start.slice(0, 4)}-01-01`;
  // Fenêtre de lecture des badges : [period_start, period_end] est
  // inclusif (period_end = dernier jour calendaire du mois, voir
  // GeneratePayslipForm), donc le filtre haut doit couvrir toute cette
  // dernière journée — même piège que documenté dans lib/planning/dates.ts.
  const badgeWindowEnd = addDays(parsed.data.period_end, 1);

  const [{ data: employee }, { data: contract }, { data: organization }, { data: employeeFile }, { data: badgeRows }, { data: leaveRows }, { data: priorPayslips }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, full_name, role_title, address")
        .eq("id", parsed.data.user_id)
        .eq("organization_id", appUser.organization_id)
        .single(),
      supabase
        .from("user_contracts")
        .select("monthly_gross_salary, monthly_net_salary, contractual_monthly_hours")
        .eq("user_id", parsed.data.user_id)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("name, siret, legal_address, legal_form, ape_code, convention_collective, urssaf_number")
        .eq("id", appUser.organization_id)
        .single(),
      supabase
        .from("employee_files")
        .select("matricule, social_security_number, classification, hire_date, contract_type")
        .eq("user_id", parsed.data.user_id)
        .maybeSingle(),
      timeClockEnabled
        ? supabase
            .from("time_clock_entries")
            .select("clocked_in_at, clocked_out_at")
            .eq("user_id", parsed.data.user_id)
            .not("clocked_out_at", "is", null)
            .gte("clocked_in_at", `${parsed.data.period_start}T00:00:00`)
            .lt("clocked_in_at", `${badgeWindowEnd}T00:00:00`)
        : Promise.resolve({ data: null }),
      supabase
        .from("leave_requests")
        .select("start_date, end_date")
        .eq("driver_id", parsed.data.user_id)
        .eq("status", "approved")
        .lte("start_date", parsed.data.period_end)
        .gte("end_date", parsed.data.period_start),
      supabase
        .from("payslips")
        .select("gross_amount, net_amount")
        .eq("user_id", parsed.data.user_id)
        .gte("period_start", yearStart)
        .lt("period_start", parsed.data.period_start),
    ]);

  if (!employee) return NextResponse.json({ error: "Employé introuvable." }, { status: 404 });
  if (!contract?.monthly_gross_salary || !contract?.monthly_net_salary) {
    return NextResponse.json({ error: "Salaire brut/net non renseigné pour cet employé (voir /payroll)." }, { status: 422 });
  }

  const mealVouchersAmount = parsed.data.meal_vouchers_amount ?? 0;
  const bonusAmount = parsed.data.bonus_amount ?? 0;
  const thisGross = Number(contract.monthly_gross_salary) + bonusAmount;
  const thisNet = Number(contract.monthly_net_salary) + bonusAmount + mealVouchersAmount;

  const workedHours = timeClockEnabled
    ? (badgeRows ?? []).reduce((total, b) => total + Math.max((new Date(b.clocked_out_at).getTime() - new Date(b.clocked_in_at).getTime()) / 3_600_000, 0), 0)
    : null;

  const periodStartDate = new Date(`${parsed.data.period_start}T00:00:00Z`);
  const periodEndDate = new Date(`${parsed.data.period_end}T00:00:00Z`);
  const leaveDaysTaken = (leaveRows ?? []).reduce((total, lr) => {
    const clampedStart = new Date(Math.max(new Date(`${lr.start_date}T00:00:00Z`).getTime(), periodStartDate.getTime()));
    const clampedEnd = new Date(Math.min(new Date(`${lr.end_date}T00:00:00Z`).getTime(), periodEndDate.getTime()));
    return total + countWeekdays(clampedStart, clampedEnd);
  }, 0);

  const cumulGrossYTD = (priorPayslips ?? []).reduce((total, p) => total + Number(p.gross_amount), 0) + thisGross;
  const cumulNetYTD = (priorPayslips ?? []).reduce((total, p) => total + Number(p.net_amount), 0) + thisNet;

  const periodStart = new Date(parsed.data.period_start);
  let pdfBytes: Buffer;
  try {
    pdfBytes = await generatePayslipPdf({
      organizationName: organization?.name ?? "Organisation",
      organizationAddress: organization?.legal_address ?? null,
      organizationSiret: organization?.siret ?? null,
      organizationLegalForm: organization?.legal_form ?? null,
      organizationApeCode: organization?.ape_code ?? null,
      organizationConventionCollective: organization?.convention_collective ?? null,
      organizationUrssafNumber: organization?.urssaf_number ?? null,
      employeeName: employee.full_name,
      employeeRoleTitle: employee.role_title,
      employeeAddress: employee.address ?? null,
      employeeMatricule: employeeFile?.matricule ?? null,
      employeeSocialSecurityNumber: employeeFile?.social_security_number ?? null,
      employeeClassification: employeeFile?.classification ?? null,
      employeeContractTypeLabel: employeeFile?.contract_type ? (CONTRACT_TYPE_LABELS[employeeFile.contract_type] ?? employeeFile.contract_type) : null,
      employeeHireDateLabel: employeeFile?.hire_date ? DAY_LABEL.format(new Date(`${employeeFile.hire_date}T00:00:00Z`)) : null,
      periodLabel: MONTH_LABEL.format(periodStart),
      periodStartLabel: DAY_LABEL.format(new Date(parsed.data.period_start)),
      periodEndLabel: DAY_LABEL.format(new Date(parsed.data.period_end)),
      generatedAtLabel: DAY_LABEL.format(new Date()),
      grossSalary: Number(contract.monthly_gross_salary),
      netSalary: Number(contract.monthly_net_salary),
      mealVouchersAmount: mealVouchersAmount || null,
      bonusAmount: bonusAmount || null,
      contractualMonthlyHours: contract.contractual_monthly_hours !== null ? Number(contract.contractual_monthly_hours) : null,
      workedHours,
      leaveDaysTaken,
      cumulGrossYTD,
      cumulNetYTD,
    });
  } catch (e) {
    console.error("payslips/generate: PDF rendering failed", e);
    return NextResponse.json({ error: "Échec de la génération du PDF." }, { status: 500 });
  }

  const filePath = `${appUser.organization_id}/${parsed.data.user_id}/${randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage.from("payslips").upload(filePath, pdfBytes, { contentType: "application/pdf" });
  if (uploadError) return NextResponse.json({ error: `Échec de l'envoi: ${uploadError.message}` }, { status: 500 });

  const { error: insertError } = await supabase.from("payslips").insert({
    organization_id: appUser.organization_id,
    user_id: parsed.data.user_id,
    period_start: parsed.data.period_start,
    period_end: parsed.data.period_end,
    gross_amount: thisGross,
    net_amount: thisNet,
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
    // that itself could fail.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "Une fiche de paie existe déjà pour ce chauffeur sur cette période." }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
