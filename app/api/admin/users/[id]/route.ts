import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  role: z.enum(["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"]).optional(),
  role_title: z.string().nullable().optional(),
  active: z.boolean().optional(),
  full_name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  // Richer replacement for service_id above — several qualified
  // services per driver, each with its own status (titulaire/
  // formation/remplacement). Sent by DriverServicesPanel; service_id
  // stays for the admin table's quick single-service edit. Only one
  // of the two is expected per request.
  services: z
    .array(z.object({ service_id: z.string().uuid(), status: z.enum(["titulaire", "formation", "remplacement"]) }))
    .optional(),
  // Lot 7: forgets their PIN → direction clears it, next badge scan
  // offers "créez votre code" again instead of "entrez votre code".
  reset_pin: z.boolean().optional(),
  // Ajusté au cas par cas par la direction (lecture du contrat) — voir /payroll.
  hourly_rate: z.number().min(0).max(999.99).nullable().optional(),
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
  // panel: since only `direction` can change roles or deactivate
  // accounts, demoting or deactivating the last `direction` account
  // (including your own) would leave nobody able to undo it from the UI.
  const demotesOrDeactivates = (parsed.data.role && parsed.data.role !== "direction") || parsed.data.active === false;
  if (demotesOrDeactivates) {
    const { data: target } = await supabase.from("users").select("role").eq("id", id).single();
    if (target?.role === "direction") {
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", appUser.organization_id)
        .eq("role", "direction")
        .eq("active", true);
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Impossible de retirer ou désactiver le dernier compte direction de l'organisation." },
          { status: 409 },
        );
      }
    }
  }

  const { service_id, services, reset_pin, ...userFields } = parsed.data;
  const updateFields: Record<string, unknown> = { ...userFields };

  if (reset_pin) {
    const { data: target } = await supabase.from("users").select("auth_method").eq("id", id).single();
    if (target?.auth_method !== "pin") {
      return NextResponse.json({ error: "Ce compte ne se connecte pas par code PIN." }, { status: 409 });
    }
    updateFields.pin_set_at = null;
  }

  let targetUser: { id: string; role: string } | null = null;
  if (Object.keys(updateFields).length > 0) {
    const { data, error } = await supabase.from("users").update(updateFields).eq("id", id).select("id, role, role_title").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    targetUser = data;
  }

  if (services !== undefined) {
    // Full replace: a driver qualified on several services, each with
    // its own status (titulaire/formation/remplacement) — see
    // DriverServicesPanel.
    const { error: clearError } = await supabase.from("user_services").delete().eq("user_id", id);
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });
    if (services.length > 0) {
      const { error: insertError } = await supabase
        .from("user_services")
        .insert(services.map((s) => ({ user_id: id, service_id: s.service_id, status: s.status })));
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  } else if (service_id !== undefined) {
    // A user has at most one service through the admin table's quick
    // edit — replace rather than accumulate rows in the underlying
    // many-to-many table.
    const { error: clearError } = await supabase.from("user_services").delete().eq("user_id", id);
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });
    if (service_id) {
      const { error: linkError } = await supabase.from("user_services").insert({ user_id: id, service_id });
      if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ user: targetUser ?? { id } });
}
