import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  name: z.string().min(1),
  fuel_type: z.enum(["diesel", "adblue"]),
  capacity_liters: z.number().positive(),
  current_totalizer_index: z.number().min(0).default(0),
  service_id: z.string().uuid().nullable().optional(),
});

/**
 * Self-service tanks CRUD (Module 9 personalization). RLS
 * ("tanks: manager-like write scoped to service", see
 * supabase/migrations/20260101000009_rls_policies.sql) has the final
 * say on which service a manager-like user may attach a tank to —
 * this route only pre-checks role, not service scope.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les cuves" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tanks")
    .insert({
      organization_id: appUser.organization_id,
      name: parsed.data.name,
      fuel_type: parsed.data.fuel_type,
      capacity_liters: parsed.data.capacity_liters,
      current_totalizer_index: parsed.data.current_totalizer_index,
      service_id: parsed.data.service_id || null,
    })
    .select("id, name, fuel_type, capacity_liters, current_totalizer_index, service_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tank: data });
}
