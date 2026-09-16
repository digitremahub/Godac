import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  role: z.enum(["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"]).optional(),
  active: z.boolean().optional(),
});

/**
 * Role changes are a plain update to `public.users.role` — nothing
 * external to keep in sync now that GODAC's 5 roles live only in our
 * own table (see supabase/migrations/20260101000002_core_tables.sql).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut modifier les rôles" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Guard against locking an organisation out of its own admin
  // panel: since only `direction` can change roles, removing the
  // last `direction` account (including demoting yourself) would
  // leave nobody able to undo it from the UI.
  if (parsed.data.role && parsed.data.role !== "direction") {
    const { data: target } = await supabase.from("users").select("role").eq("id", id).single();
    if (target?.role === "direction") {
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", appUser.organization_id)
        .eq("role", "direction");
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Impossible de retirer le rôle direction du dernier compte direction de l'organisation." },
          { status: 409 },
        );
      }
    }
  }

  const { data: targetUser, error } = await supabase
    .from("users")
    .update(parsed.data)
    .eq("id", id)
    .select("id, role")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ user: targetUser });
}
