import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { voitToutLOrganisation } from "@/lib/roles/perimetre";

const writeRoles = ["direction", "manager", "exploitation"] as const;

const patchSchema = z.object({ active: z.boolean() });

/**
 * Désactive (retire de la liste) ou réactive un modèle de tournée. Le
 * modèle est conservé : les affectations déjà générées ne changent pas.
 * Direction : tous les services ; responsable : ses services.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!writeRoles.includes(appUser.role as (typeof writeRoles)[number])) {
    return NextResponse.json({ error: "Seule la Direction ou un responsable autorisé peut modifier une affectation récurrente." }, { status: 403 });
  }
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Modèle invalide." }, { status: 400 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: modele } = await supabase
    .from("planning_tour_templates")
    .select("id, service_id")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (!modele) return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });

  if (!voitToutLOrganisation(appUser.role)) {
    const { data: lien } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id).eq("service_id", modele.service_id).maybeSingle();
    if (!lien) return NextResponse.json({ error: "Ce service ne fait pas partie de vos services autorisés." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("planning_tour_templates")
    .update({ active: parsed.data.active })
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .select("id, active")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Modèle introuvable." }, { status: 404 });
  return NextResponse.json({ template: data });
}
