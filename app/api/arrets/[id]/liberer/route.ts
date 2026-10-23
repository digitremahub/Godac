import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { affectationsALiberer } from "@/lib/arrets/declaration";
import { affectationsPendantArret, lireArrets } from "@/lib/arrets/serveur";
import { garderDecision } from "@/lib/hierarchie/serveur";

/**
 * « Libérer ces N affectations » : retire le salarié en arrêt de ses
 * affectations encore prévues et à venir pendant l'arrêt. La tournée
 * reste au planning, sans chauffeur (driver_id vide : « Sans chauffeur »),
 * à réattribuer. Tournées démarrées ou passées inchangées. Écriture avec
 * le client de l'utilisateur : la RLS du planning (manager : ses
 * services) reste l'autorité.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ENCADREMENT, modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;

  const arret = (await lireArrets(supabase, { id })).lignes[0];
  if (!arret) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
  // Hiérarchie : on ne réorganise pas le planning de son propre arrêt.
  const garde = await garderDecision(supabase, appUser, arret.userId);
  if (!garde.ok) return garde.reponse;
  if (arret.statut === "refuse") return NextResponse.json({ error: "Arrêt refusé : rien à libérer." }, { status: 422 });

  const aLiberer = affectationsALiberer(await affectationsPendantArret(supabase, appUser.organization_id, arret.userId, arret.du, arret.au), arret);
  if (aLiberer.length === 0) return NextResponse.json({ ok: true, liberees: 0 });

  const { data, error } = await supabase
    .from("planning_entries")
    .update({ driver_id: null })
    .in(
      "id",
      aLiberer.map((e) => e.id),
    )
    .eq("driver_id", arret.userId)
    .eq("status", "planned")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "arret_affectations_liberees",
    targetTable: "work_stoppages",
    targetId: id,
    details: { salarie: arret.userId, affectations: (data ?? []).map((e) => e.id) },
  });
  return NextResponse.json({ ok: true, liberees: (data ?? []).length });
}
