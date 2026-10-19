import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { deciderValidation, ROLES_VALIDATION, statutValide } from "@/lib/paie/validation";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  decision: z.enum(["valider", "refuser"]),
  commentaire: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Validation ou refus de bulletins par la direction (décision client Q1).
 * Qui et quand sont écrits par la base (trigger payslips_guard_validation),
 * qui refuse aussi toute validation par un autre rôle ; chaque décision est
 * inscrite au journal d'audit.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ROLES_VALIDATION, modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { ids, decision, commentaire } = parsed.data;

  const { data: bulletins, error } = await supabase
    .from("payslips")
    .select("id, user_id, period_start, validation_status")
    .eq("organization_id", appUser.organization_id)
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!bulletins || bulletins.length === 0) return NextResponse.json({ error: "Bulletin introuvable." }, { status: 404 });

  const traites: string[] = [];
  const ignores: { id: string; raison: string }[] = [];
  for (const b of bulletins) {
    const d = deciderValidation({ role: appUser.role, decision, commentaire, statutActuel: statutValide(b.validation_status) });
    if (!d.ok) {
      ignores.push({ id: b.id, raison: d.message });
      continue;
    }
    const { error: updateError } = await supabase
      .from("payslips")
      .update({ validation_status: d.statut, validation_comment: d.statut === "refuse" ? commentaire!.trim() : null })
      .eq("id", b.id);
    if (updateError) {
      ignores.push({ id: b.id, raison: updateError.message });
      continue;
    }
    traites.push(b.id);
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: d.statut === "valide" ? "paie_bulletin_valide" : "paie_bulletin_refuse",
      targetTable: "payslips",
      targetId: b.id,
      details: { salarie: b.user_id, mois: String(b.period_start).slice(0, 7), ...(d.statut === "refuse" ? { commentaire: commentaire!.trim() } : {}) },
    });
  }

  if (traites.length === 0) {
    return NextResponse.json({ error: ignores[0]?.raison ?? "Aucun bulletin traité.", ignores }, { status: 409 });
  }
  return NextResponse.json({ ok: true, traites, ignores });
}
