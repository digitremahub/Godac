import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  fuel_type: z.enum(["diesel", "adblue"]).optional(),
  capacity_liters: z.number().positive().optional(),
  service_id: z.string().uuid().nullable().optional(),
});

/**
 * `current_totalizer_index` is deliberately not editable here — it's
 * the shared-tank continuity anchor the totalizer-gap check relies
 * on (see lib/business/totalizer-gap.ts); it only ever moves forward
 * via a trusted fuel entry, never a manual settings edit.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les cuves" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tanks")
    .update(parsed.data)
    .eq("id", id)
    .select("id, name, fuel_type, capacity_liters, current_totalizer_index, service_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tank: data });
}

/**
 * fuel_entries.tank_id is `on delete restrict` (see
 * supabase/migrations/20260101000003_fuel_tables.sql) — a tank with
 * fuel history can't be deleted, and that FK error is surfaced as-is
 * rather than silently cascading history away.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g2 = await garderApi({ roles: "tous" });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  if (!hasRole(appUser.role, ["manager", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les cuves" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("tanks").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Cette cuve a des ravitaillements enregistrés et ne peut pas être supprimée." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
