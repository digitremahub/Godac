import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { peutGererTournees } from "@/lib/tours/acces-tournees";
import { sanitizeRenfortVillageIds } from "@/lib/tours/renfort";
import { loadRenfortContext } from "@/lib/tours/renfort-serveur";

const bodySchema = z.object({
  planning_entry_id: z.string().uuid(),
  /** Vide = revenir à la couverture par défaut du renfort pour ce passage. */
  village_ids: z.array(z.string().uuid()).max(500),
});

/**
 * Villages couverts par un passage planifié précis d'une tournée de
 * renfort (un jour donné), quand ils diffèrent de la couverture par
 * défaut. Le passage doit être une ligne du planning de cette tournée,
 * visible par l'utilisateur (droits du planning).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  if (!peutGererTournees(appUser.role)) {
    return NextResponse.json({ error: "Réservé à la direction et aux chefs d'équipe." }, { status: 403 });
  }
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const ctx = await loadRenfortContext(supabase, id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { data: entry } = await supabase.from("planning_entries").select("id, tour_number").eq("id", parsed.data.planning_entry_id).maybeSingle();
  if (!entry || entry.tour_number !== ctx.renfort.tour_number) {
    return NextResponse.json({ error: "Passage planifié introuvable pour cette tournée." }, { status: 404 });
  }
  const villageIds = sanitizeRenfortVillageIds(parsed.data.village_ids, ctx.candidates);

  const { error: deleteError } = await supabase.from("planning_entry_renfort_villages").delete().eq("planning_entry_id", entry.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  if (villageIds.length) {
    const { error } = await supabase
      .from("planning_entry_renfort_villages")
      .insert(villageIds.map((villageId) => ({ organization_id: appUser.organization_id, planning_entry_id: entry.id, village_id: villageId })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, village_ids: villageIds });
}
