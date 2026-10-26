import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { appliquerReconciliation, reconcilier, texteReconciliation } from "@/lib/planning/fusion";
import { chauffeursDeLaFusion, lireReel } from "@/lib/planning/fusion-serveur";
import { garderFusion, reponseErreurFusion } from "@/lib/planning/fusion-acces";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { jourDe } from "@/lib/planning/semaine";

/**
 * Prévu / réel d'une tournée fusionnée. Le réel : les fiches Tournée colis
 * des chauffeurs de la fusion ce jour-là (villages réellement desservis,
 * ramasses présentes ou faites). Lecture admin bornée à l'organisation (un
 * manager ne lit pas toutes les fiches), après le contrôle de rôle et de
 * service de la ligne de planning.
 *
 * GET : écarts et corrections proposées.
 * POST : applique les corrections (toutes, ou celles de `cles`) ; le réel
 * fait foi, les lignes deviennent « confirmées ». Le reste se corrige à la
 * main depuis la feuille « Répartir ».
 */
async function calculer(ctx: Extract<Awaited<ReturnType<typeof garderFusion>>, { ok: true }>) {
  const { appUser, supabase, entree, fusion } = ctx;
  if (!fusion) return null;
  const date = jourDe(entree.start_at);
  const prevus = fusion.lignes.map((l) => l.driver_id).filter((x): x is string => Boolean(x));
  const drivers = [...new Set([...(await chauffeursDeLaFusion(supabase, appUser.organization_id, entree)), ...prevus])];
  const reel = await lireReel(createAdminSupabaseClient(), appUser.organization_id, date, drivers, fusion.elements);
  const tous = [...fusion.elements.villages, ...fusion.elements.ramasses];
  return { tous, reel, reconciliation: reconcilier(tous, fusion.lignes, reel), fusion, date };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await garderFusion((await params).id);
  if (!ctx.ok) return ctx.reponse;
  const r = await calculer(ctx);
  if (!r) return NextResponse.json({ error: "Cette tournée n'est pas marquée comme fusionnée." }, { status: 409 });
  return NextResponse.json({ ...r.reconciliation, texte: texteReconciliation(r.reconciliation.resume), date: r.date });
}

const postSchema = z.object({ cles: z.array(z.string().max(320)).max(600).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await garderFusion((await params).id);
  if (!ctx.ok) return ctx.reponse;
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const r = await calculer(ctx);
  if (!r) return NextResponse.json({ error: "Cette tournée n'est pas marquée comme fusionnée." }, { status: 409 });
  const { appUser, supabase, entree } = ctx;

  const choisies = parsed.data.cles ? new Set(parsed.data.cles) : null;
  const propositions = r.reconciliation.propositions.filter((p) => !choisies || choisies.has(`${p.kind}:${p.cle}`));
  const lignes = appliquerReconciliation(r.tous, r.fusion.lignes, propositions);
  if (!lignes.length) return NextResponse.json({ ok: true, appliquees: 0, texte: "Rien à corriger." });

  const maintenant = new Date().toISOString();
  const { error } = await supabase
    .from("planning_entry_repartition")
    .upsert(lignes.map((l) => ({ ...l, organization_id: appUser.organization_id, planning_entry_id: entree.id, updated_by: appUser.id, updated_at: maintenant })), { onConflict: "planning_entry_id,kind,element_key" });
  if (error) return reponseErreurFusion(error);
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "tournee_repartition_reconciliee",
    targetTable: "planning_entries",
    targetId: entree.id,
    details: { tour_number: entree.tour_number, start_at: entree.start_at, appliquees: lignes.length, ...r.reconciliation.resume },
  });
  return NextResponse.json({ ok: true, appliquees: lignes.length, texte: `${lignes.length} élément${lignes.length > 1 ? "s" : ""} aligné${lignes.length > 1 ? "s" : ""} sur les tournées réelles.` });
}
