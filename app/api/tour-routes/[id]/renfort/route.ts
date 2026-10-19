import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { peutGererTournees } from "@/lib/tours/acces-tournees";
import { sanitizeRenfortVillageIds } from "@/lib/tours/renfort";
import { loadRenfortContext } from "@/lib/tours/renfort-serveur";

const bodySchema = z.object({ village_ids: z.array(z.string().uuid()).max(500) });

/**
 * Villages couverts PAR DÉFAUT par une tournée de renfort (empruntés aux
 * autres tournées du même service). Remplace toute la liste.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!peutGererTournees(appUser.role)) {
    return NextResponse.json({ error: "Réservé à la direction et aux chefs d'équipe." }, { status: 403 });
  }
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Liste de villages invalide." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const ctx = await loadRenfortContext(supabase, id);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const villageIds = sanitizeRenfortVillageIds(parsed.data.village_ids, ctx.candidates);

  const { error: deleteError } = await supabase.from("tour_route_renfort_villages").delete().eq("renfort_route_id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  if (villageIds.length) {
    const { error } = await supabase
      .from("tour_route_renfort_villages")
      .insert(villageIds.map((villageId) => ({ organization_id: appUser.organization_id, renfort_route_id: id, village_id: villageId })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, village_ids: villageIds });
}
