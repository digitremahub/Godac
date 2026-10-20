import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePayslipPdf } from "@/lib/payslips/generate-pdf";
import { countWeekdays } from "@/lib/business/payroll";
import { addDays } from "@/lib/planning/dates";
import { isModuleEnabled } from "@/lib/organization/modules";

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const CONTRACT_TYPE_LABELS: Record<string, string> = { cdi: "CDI", cdd: "CDD", interim: "Intérim", apprentissage: "Apprentissage" };

/** Thrown with the HTTP status the calling route should return — keeps both /generate and /[id]/regenerate's error handling identical. */
export class PayslipBuildError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Shared by the first-generation route (app/api/payslips/generate) and
 * the regeneration route (app/api/payslips/[id]/regenerate) — same PDF,
 * built from the same live data, whether it's the first bulletin for
 * this period or a correction overwriting one already generated.
 * Re-reads everything at call time (contract, fiche employeur/employé,
 * heures badgées, congés, cumuls) rather than trusting any previously
 * stored snapshot, precisely so a regénération picks up whatever was
 * wrong the first time (salaire corrigé depuis, SIRET renseigné
 * depuis, etc.).
 */
export async function buildPayslip({
  supabase,
  organizationId,
  userId,
  periodStart,
  periodEnd,
  mealVouchersAmount,
  bonusAmount,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  mealVouchersAmount: number;
  bonusAmount: number;
}): Promise<{ pdfBytes: Buffer; grossAmount: number; netAmount: number }> {
  const timeClockEnabled = await isModuleEnabled(supabase, organizationId, "time_clock");
  const yearStart = `${periodStart.slice(0, 4)}-01-01`;
  // Fenêtre de lecture des badges : [period_start, period_end] est
  // inclusif (period_end = dernier jour calendaire du mois, voir
  // GeneratePayslipForm), donc le filtre haut doit couvrir toute cette
  // dernière journée — même piège que documenté dans lib/planning/dates.ts.
  const badgeWindowEnd = addDays(periodEnd, 1);

  const [{ data: employee }, { data: contract }, { data: organization }, { data: employeeFile }, { data: badgeRows }, { data: leaveRows }, { data: priorPayslips }, { data: contributionLineRows }] =
    await Promise.all([
      supabase.from("users").select("id, full_name, role_title, address").eq("id", userId).eq("organization_id", organizationId).single(),
      supabase
        .from("user_contracts")
        .select("monthly_gross_salary, monthly_net_salary, contractual_monthly_hours")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("name, siret, legal_address, legal_form, ape_code, convention_collective, urssaf_number")
        .eq("id", organizationId)
        .single(),
      supabase
        .from("employee_files")
        .select("matricule, social_security_number, classification, hire_date, contract_type")
        .eq("user_id", userId)
        .maybeSingle(),
      timeClockEnabled
        ? supabase
            .from("time_clock_entries")
            .select("clocked_in_at, clocked_out_at")
            .eq("user_id", userId)
            .not("clocked_out_at", "is", null)
            .gte("clocked_in_at", `${periodStart}T00:00:00`)
            .lt("clocked_in_at", `${badgeWindowEnd}T00:00:00`)
        : Promise.resolve({ data: null }),
      supabase
        .from("leave_requests")
        .select("start_date, end_date")
        .eq("driver_id", userId)
        .eq("status", "approved")
        .lte("start_date", periodEnd)
        .gte("end_date", periodStart),
      supabase.from("payslips").select("gross_amount, net_amount").eq("user_id", userId).gte("period_start", yearStart).lt("period_start", periodStart),
      supabase.from("payslip_contribution_lines").select("label, salarial_rate, patronal_rate").eq("organization_id", organizationId).order("created_at"),
    ]);

  if (!employee) throw new PayslipBuildError("Employé introuvable.", 404);
  if (!contract?.monthly_gross_salary || !contract?.monthly_net_salary) {
    throw new PayslipBuildError("Salaire brut/net non renseigné pour cet employé (voir /equipe/paie/heures).", 422);
  }

  const grossAmount = Number(contract.monthly_gross_salary) + bonusAmount;
  const netAmount = Number(contract.monthly_net_salary) + bonusAmount + mealVouchersAmount;

  // Taux saisis une fois par la direction (voir PayslipContributionLinesPanel),
  // appliqués ici au brut de ce bulletin — vide tant que rien n'est
  // configuré, auquel cas generatePayslipPdf garde la ligne globale
  // "estimation" historique.
  const contributionLines = (contributionLineRows ?? []).map((l) => ({
    label: l.label,
    salarialAmount: (grossAmount * Number(l.salarial_rate)) / 100,
    patronalAmount: (grossAmount * Number(l.patronal_rate)) / 100,
  }));

  const workedHours = timeClockEnabled
    ? (badgeRows ?? []).reduce((total, b) => total + Math.max((new Date(b.clocked_out_at).getTime() - new Date(b.clocked_in_at).getTime()) / 3_600_000, 0), 0)
    : null;

  const periodStartDate = new Date(`${periodStart}T00:00:00Z`);
  const periodEndDate = new Date(`${periodEnd}T00:00:00Z`);
  const leaveDaysTaken = (leaveRows ?? []).reduce((total, lr) => {
    const clampedStart = new Date(Math.max(new Date(`${lr.start_date}T00:00:00Z`).getTime(), periodStartDate.getTime()));
    const clampedEnd = new Date(Math.min(new Date(`${lr.end_date}T00:00:00Z`).getTime(), periodEndDate.getTime()));
    return total + countWeekdays(clampedStart, clampedEnd);
  }, 0);

  const cumulGrossYTD = (priorPayslips ?? []).reduce((total, p) => total + Number(p.gross_amount), 0) + grossAmount;
  const cumulNetYTD = (priorPayslips ?? []).reduce((total, p) => total + Number(p.net_amount), 0) + netAmount;

  const periodStartForLabel = new Date(periodStart);
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
      periodLabel: MONTH_LABEL.format(periodStartForLabel),
      periodStartLabel: DAY_LABEL.format(new Date(periodStart)),
      periodEndLabel: DAY_LABEL.format(new Date(periodEnd)),
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
      contributionLines: contributionLines.length > 0 ? contributionLines : null,
    });
  } catch (e) {
    console.error("buildPayslip: PDF rendering failed", e);
    throw new PayslipBuildError("Échec de la génération du PDF.", 500);
  }

  return { pdfBytes, grossAmount, netAmount };
}
