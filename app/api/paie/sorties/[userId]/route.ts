import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { ROLES_GENERATION } from "@/lib/paie/validation";
import { sortieSchema } from "@/lib/paie/schemas";

/**
 * Sortie d'un salarié (employee_exits) : date, motif, préavis, montant de
 * l'indemnité convenue, emplois occupés. Direction et comptable. Le
 * bulletin du mois de sortie en reprend les éléments (lib/paie/sortie.ts).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const g = await garderApi({ roles: ROLES_GENERATION, modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const { userId } = await params;
  const parsed = sortieSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Sortie invalide : date et motif sont obligatoires." }, { status: 400 });
  const { data: user } = await supabase.from("users").select("id").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!user) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });
  const { error } = await supabase
    .from("employee_exits")
    .upsert({ user_id: userId, organization_id: appUser.organization_id, ...parsed.data, created_by: appUser.id, updated_at: new Date().toISOString() });
  if (error) {
    const absente = /employee_exits/.test(error.message) && /(does not exist|schema cache|not find)/i.test(error.message);
    return NextResponse.json({ error: absente ? "Sorties indisponibles : la migration 20261026000002 n'est pas encore appliquée." : error.message }, { status: absente ? 503 : 500 });
  }
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "paie_sortie_enregistree",
    targetTable: "employee_exits",
    targetId: userId,
    details: { date: parsed.data.exit_date, motif: parsed.data.reason },
  });
  return NextResponse.json({ ok: true });
}
