import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { providerSchema } from "@/lib/rental/schemas";

/** Modification (ou archivage via `active: false`) d'un loueur / prestataire. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["rental_providers"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Réservé aux responsables et à la direction." }, { status: 403 });
  }
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "rental_providers"))) {
    return NextResponse.json({ error: "Module Véhicules loués non activé." }, { status: 403 });
  }
  const parsed = providerSchema.partial().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Champs invalides." }, { status: 400 });

  const { data, error } = await supabase
    .from("rental_providers")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Prestataire introuvable." }, { status: 404 });
  return NextResponse.json({ provider: data });
}
