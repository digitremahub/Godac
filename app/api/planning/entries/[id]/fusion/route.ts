import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";
import { resumeRepartition } from "@/lib/planning/fusion";
import { chauffeursDeLaFusion, definirFusion } from "@/lib/planning/fusion-serveur";
import { garderFusion, reponseErreurFusion } from "@/lib/planning/fusion-acces";

/**
 * Tournée fusionnée du lundi (planning_entry_merged_routes, migration
 * 20261105000001) : tournées d'origine d'une ligne de planning, et ce qu'il
 * y a à répartir (villages et ramasses de ces tournées).
 *
 * GET : état de la fusion pour la feuille « Répartir » (tournées d'origine,
 * éléments, répartition, chauffeurs proposés).
 * PUT : marque la ligne comme fusionnée avec ces tournées d'origine
 * (liste vide : ce n'est plus une tournée fusionnée, la répartition
 * provisoire est effacée). Les fiches déjà créées ne sont pas touchées ici.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await garderFusion((await params).id);
  if (!ctx.ok) return ctx.reponse;
  const { appUser, supabase, entree, fusion } = ctx;

  const [{ data: routes }, ids] = await Promise.all([
    supabase.from("tour_routes").select("id, tour_number, service_id, tour_route_villages(id)").eq("organization_id", appUser.organization_id).order("tour_number"),
    chauffeursDeLaFusion(supabase, appUser.organization_id, entree),
  ]);
  // Chauffeurs proposés : ceux de la tournée ce jour-là d'abord, puis les autres du service.
  const { data: rattaches } = await supabase.from("user_services").select("user_id").eq("service_id", entree.service_id);
  const idsService = ((rattaches ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const tous = [...new Set([...ids, ...idsService])];
  const { data: users } = tous.length
    ? await supabase.from("users").select("id, full_name").eq("organization_id", appUser.organization_id).eq("active", true).or(FILTRE_CONDUCTEURS).in("id", tous)
    : { data: [] };
  const chauffeurs = ((users ?? []) as { id: string; full_name: string }[])
    .map((u) => ({ id: u.id, full_name: u.full_name, sur_la_tournee: ids.includes(u.id) }))
    .sort((a, b) => Number(b.sur_la_tournee) - Number(a.sur_la_tournee) || a.full_name.localeCompare(b.full_name, "fr"));

  const tousElements = fusion ? [...fusion.elements.villages, ...fusion.elements.ramasses] : [];
  return NextResponse.json({
    fusionnee: Boolean(fusion),
    routes: fusion?.routes ?? [],
    routes_disponibles: ((routes ?? []) as { id: string; tour_number: string; service_id: string | null; tour_route_villages: { id: string }[] | null }[])
      .filter((r) => !r.service_id || r.service_id === entree.service_id)
      .map((r) => ({ id: r.id, tour_number: r.tour_number, villages: (r.tour_route_villages ?? []).length })),
    elements: fusion ? fusion.elements : { villages: [], ramasses: [] },
    lignes: fusion?.lignes ?? [],
    resume: resumeRepartition(tousElements, fusion?.lignes ?? []),
    chauffeurs,
  });
}

const putSchema = z.object({ route_ids: z.array(z.string().uuid()).max(12) });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await garderFusion((await params).id);
  if (!ctx.ok) return ctx.reponse;
  const { appUser, supabase, entree } = ctx;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  if (entree.status === "done" || entree.status === "cancelled") return NextResponse.json({ error: "Tournée terminée ou annulée : la fusion ne change plus." }, { status: 409 });

  // Seulement des tournées de l'organisation (la RLS ne montre que celles-là, on le vérifie quand même).
  const ids = [...new Set(parsed.data.route_ids)];
  if (ids.length) {
    const { data: valides } = await supabase.from("tour_routes").select("id").eq("organization_id", appUser.organization_id).in("id", ids);
    if ((valides ?? []).length !== ids.length) return NextResponse.json({ error: "Tournée d'origine introuvable." }, { status: 400 });
  }
  const r = await definirFusion(supabase, appUser.organization_id, appUser.id, entree.id, ids);
  if (r.erreur) return reponseErreurFusion({ message: r.erreur, code: r.manquante ? "42P01" : null });
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "tournee_fusion_modifiee",
    targetTable: "planning_entries",
    targetId: entree.id,
    details: { tour_number: entree.tour_number, start_at: entree.start_at, routes: ids.length },
  });
  return NextResponse.json({ ok: true, fusionnee: ids.length > 0, routes: ids.length });
}
