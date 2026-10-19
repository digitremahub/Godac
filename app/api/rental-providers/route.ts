import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { providerSchema } from "@/lib/rental/schemas";

/** Création d'un loueur / garage prestataire (module rental_providers, responsables et direction). */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["rental_providers"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Réservé aux responsables et à la direction." }, { status: 403 });
  }
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "rental_providers"))) {
    return NextResponse.json({ error: "Module Véhicules loués non activé." }, { status: 403 });
  }
  const parsed = providerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Champs invalides." }, { status: 400 });

  const { data, error } = await supabase
    .from("rental_providers")
    .insert({ ...parsed.data, organization_id: appUser.organization_id, created_by: appUser.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ provider: data });
}
