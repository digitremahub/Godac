import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  tank_id: z.string().uuid(),
  liters: z.coerce.number().positive(),
  unit_price: z.coerce.number().positive().optional(),
  supplier: z.string().optional(),
  delivered_at: z.string().datetime().optional(),
});

/**
 * Records a fuel delivery into a tank ("approvisionnement") — the
 * Phase 2 feature the /tanks page used to only disclaim. RLS
 * ("tank_deliveries: manager-like write scoped to service") is the
 * real gate; this route just gives a clearer error. Bumping
 * tanks.current_stock_liters and raising a tank_overflow alert if it
 * exceeds capacity both happen in the after_tank_delivery trigger.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour enregistrer un approvisionnement" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
