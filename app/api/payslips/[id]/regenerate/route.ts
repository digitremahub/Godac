import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { buildPayslip, PayslipBuildError } from "@/lib/payslips/build-payslip";

const bodySchema = z.object({
  // Absents du corps -> on garde les montants déjà sur la fiche
  // (régénération "silencieuse", après correction du salaire par
  // exemple) ; présents -> on les remplace (correction d'une erreur de
  // saisie sur le panier/la prime elle-même).
  meal_vouchers_amount: z.coerce.number().nonnegative().optional(),
  bonus_amount: z.coerce.number().nonnegative().optional(),
});

/**
 * Régénère une fiche déjà générée — même user_id/période (on ne
 * réaffecte jamais une fiche à quelqu'un d'autre ou à un autre mois
 * depuis ici), reconstruite à partir des données actuelles (salaire,
 * identité employeur/employé, heures, congés, cumuls), pour corriger
 * une erreur sans dupliquer la ligne ni libérer le créneau pour une
 * seconde fiche sur la même période. Écrase le fichier PDF existant :
 * le nouveau est uploadé d'abord, la ligne n'est mise à jour (donc le
 * lien de téléchargement ne change) qu'une fois l'upload confirmé, et
 * l'ancien fichier n'est supprimé qu'après coup, best-effort.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const payslipsEnabled = await isModuleEnabled(supabase, appUser.organization_id, "payslips");
  if (!payslipsEnabled) {
    return NextResponse.json({ error: "Module Fiches de Paie non activé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("payslips")
    .select("id, user_id, period_start, period_end, meal_vouchers_amount, bonus_amount, file_path")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Fiche de paie introuvable." }, { status: 404 });

  const mealVouchersAmount = parsed.data.meal_vouchers_amount ?? Number(existing.meal_vouchers_amount ?? 0);
  const bonusAmount = parsed.data.bonus_amount ?? Number(existing.bonus_amount ?? 0);

  let pdfBytes: Buffer;
  let grossAmount: number;
  let netAmount: number;
  try {
    ({ pdfBytes, grossAmount, netAmount } = await buildPayslip({
      supabase,
      organizationId: appUser.organization_id,
      userId: existing.user_id,
      periodStart: existing.period_start,
      periodEnd: existing.period_end,
      mealVouchersAmount,
      bonusAmount,
    }));
  } catch (e) {
    if (e instanceof PayslipBuildError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const newFilePath = `${appUser.organization_id}/${existing.user_id}/${randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage.from("payslips").upload(newFilePath, pdfBytes, { contentType: "application/pdf" });
  if (uploadError) return NextResponse.json({ error: `Échec de l'envoi: ${uploadError.message}` }, { status: 500 });

  const { error: updateError } = await supabase
    .from("payslips")
    .update({
      gross_amount: grossAmount,
      net_amount: netAmount,
      meal_vouchers_amount: mealVouchersAmount,
      bonus_amount: bonusAmount,
      file_path: newFilePath,
      status: "generated",
      generated_by: appUser.id,
    })
    .eq("id", id);
  if (updateError) {
    // La ligne n'a pas bougé — l'ancien fichier reste valide, le nouveau devient simplement orphelin.
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (existing.file_path && existing.file_path !== newFilePath) {
    const { error: removeError } = await supabase.storage.from("payslips").remove([existing.file_path]);
    if (removeError) console.error("payslips/regenerate: ancien fichier non supprimé", removeError);
  }

  return NextResponse.json({ ok: true });
}
