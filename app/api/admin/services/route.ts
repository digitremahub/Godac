import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
});

/**
 * Self-service services CRUD (Module 9 personalization). Mirrors RLS
 * ("services: manager-like write within org", see
 * supabase/migrations/20260101000009_rls_policies.sql) — the role
 * check here just gives a clearer error than a bare RLS rejection.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les services" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("services")
    // Toujours un service transport : les pôles bureau sont créés d'office
    // (seed_standard_poles, migration 20260101000126), un par pôle.
    .insert({ organization_id: appUser.organization_id, name: parsed.data.name, code: parsed.data.code || null, pole: "exploitation" })
    .select("id, name, code, pole")
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Un service ou un pôle porte déjà ce nom." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ service: data });
}
