import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  tank_id: z.string().uuid(),
  liters: z.coerce.number().positive().max(100_000),
  // Obligatoire : c'est lui qui fixe le PMP de la cuve (prix au litre TTC de la facture).
  unit_price: z.coerce.number().positive().max(10),
  supplier: z.string().optional(),
  delivered_at: z.string().datetime().optional(),
});

/**
 * Records a fuel delivery into a tank ("approvisionnement") — the
 * Phase 2 feature the /carburant/cuves page used to only disclaim. RLS
 * ("tank_deliveries: manager-like write scoped to service") is the
 * real gate; this route just gives a clearer error. Le stock, le PMP de
 * la cuve (moyenne pondérée stock + livraison) et l'alerte de
 * débordement sont calculés par le trigger before_tank_delivery
 * (migration 121) ; une livraison enregistrée est ensuite figée.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour enregistrer un approvisionnement" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.delivered_at && new Date(parsed.data.delivered_at).getTime() > Date.now() + 10 * 60_000) {
    return NextResponse.json({ error: "La date de livraison est dans le futur." }, { status: 422 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tank_deliveries")
    .insert({
      organization_id: appUser.organization_id,
      recorded_by: appUser.id,
      tank_id: parsed.data.tank_id,
      liters: parsed.data.liters,
      unit_price: parsed.data.unit_price,
      supplier: parsed.data.supplier || null,
      delivered_at: parsed.data.delivered_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ delivery: data });
}
