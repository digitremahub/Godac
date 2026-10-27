import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { libererFicheAncienChauffeur } from "@/lib/planning/fiche-reaffectation";
import { verrouDe } from "@/lib/planning/fusion-verrou";
import { verrousDeLaPeriode } from "@/lib/planning/fusion-verrou-serveur";
import { jourDe } from "@/lib/planning/semaine";
import { noterModificationPlanning } from "@/lib/planning/suivi-auto-serveur";

/**
 * « Retirer l'affectation » d'un DOUBLON de fusion : une affectation existe sur
 * une tournée d'origine d'une fusion (lib/planning/fusion-verrou.ts), alors que
 * la tournée hôte porte déjà son travail. La ligne est supprimée (la case
 * fusionnée reste verrouillée, sans chauffeur ni ligne vide), la fiche colis
 * préparée pour le chauffeur lui est retirée (lib/planning/fiche-reaffectation.ts)
 * et l'opération est tracée (audit planning_doublon_fusion_retire).
 *
 * Seule une ligne encore « prévue » sur une case réellement fusionnée ce jour-là
 * est retirée : tout autre appel est refusé (409), jamais une affectation ordinaire.
 * Direction et exploitation : toute l'organisation ; manager : son service (RLS).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["planning"], roles: ["direction", "exploitation", "manager"] });
  if (!g.ok) return g.reponse;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Affectation invalide." }, { status: 400 });
  const { appUser, supabase } = g;

  const { data: entree, error } = await supabase
    .from("planning_entries")
    .select("id, service_id, tour_number, driver_id, start_at, status")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!entree) return NextResponse.json({ error: "Affectation introuvable." }, { status: 404 });
  if (entree.status !== "planned") return NextResponse.json({ error: "Tournée déjà démarrée ou terminée : son affectation ne peut plus être retirée." }, { status: 409 });

  const jour = jourDe(entree.start_at as string);
  const { verrous } = await verrousDeLaPeriode(supabase, appUser.organization_id, entree.service_id as string, jour, jour);
  const verrou = verrouDe(verrous, entree.service_id as string, String(entree.tour_number), jour);
  if (!verrou) return NextResponse.json({ error: "Cette tournée n'est pas fusionnée ce jour-là : ce n'est pas un doublon." }, { status: 409 });

  const warning = entree.driver_id ? await libererFicheAncienChauffeur(supabase, id) : null;
  const { data, error: erreurSuppression } = await supabase.from("planning_entries").delete().eq("id", id).eq("status", "planned").select("id, service_id, start_at").maybeSingle();
  if (erreurSuppression) return NextResponse.json({ error: erreurSuppression.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Affectation introuvable ou déjà démarrée." }, { status: 404 });

  await noterModificationPlanning(appUser.organization_id, [{ serviceId: data.service_id as string, startAt: data.start_at as string }]);
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "planning_doublon_fusion_retire",
    targetTable: "planning_entries",
    targetId: id,
    details: { tour_number: entree.tour_number, start_at: entree.start_at, chauffeur: entree.driver_id, hote: verrou.hoteNumero, ligne_hote: verrou.hoteEntryId },
  });
  return NextResponse.json({ ok: true, warning });
}
