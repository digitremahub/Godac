import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { affectationsALiberer } from "@/lib/arrets/declaration";
import { garderDecision } from "@/lib/hierarchie/serveur";
import { affectationsDuConge } from "@/lib/leaves/planning-serveur";

/**
 * « Libérer ces N affectations » après l'approbation d'un congé : retire le
 * salarié de ses affectations encore prévues et à venir pendant le congé. La
 * tournée reste au planning, sans chauffeur (« Sans chauffeur »), à
 * réattribuer. Tournées démarrées ou passées inchangées. Même mécanisme que les
 * arrêts de travail (app/api/arrets/[id]/liberer). Écriture avec le client de
 * l'utilisateur : la RLS du planning (manager : ses services) reste l'autorité.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ENCADREMENT, modules: ["leave_management", "planning"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;

  const { data: conge } = await supabase.from("leave_requests").select("id, driver_id, start_date, end_date, status").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!conge) return NextResponse.json({ error: "Demande de congé introuvable." }, { status: 404 });
  if (conge.status !== "approved") return NextResponse.json({ error: "Seul un congé approuvé libère des affectations." }, { status: 422 });
  // Hiérarchie : on ne réorganise pas le planning de son propre congé.
  const garde = await garderDecision(supabase, appUser, conge.driver_id);
  if (!garde.ok) return garde.reponse;

  const aLiberer = affectationsALiberer(await affectationsDuConge(supabase, appUser.organization_id, conge.driver_id, conge.start_date, conge.end_date), { du: conge.start_date, au: conge.end_date });
  if (aLiberer.length === 0) return NextResponse.json({ ok: true, liberees: 0 });

  const { data, error } = await supabase
    .from("planning_entries")
    .update({ driver_id: null })
    .in(
      "id",
      aLiberer.map((e) => e.id),
    )
    .eq("driver_id", conge.driver_id)
    .eq("status", "planned")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "conge_affectations_liberees",
    targetTable: "leave_requests",
    targetId: id,
    details: { salarie: conge.driver_id, affectations: (data ?? []).map((e) => e.id), du: conge.start_date, au: conge.end_date },
  });
  return NextResponse.json({ ok: true, liberees: (data ?? []).length });
}
