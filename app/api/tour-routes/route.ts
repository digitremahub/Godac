import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  tour_number: z.string().trim().min(1).max(60),
  service_id: z.string().uuid(),
});

/** Creates a tour's reference sheet (villages are added on /exploitation/tournees). */
export async function POST(req: Request) {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "direction"])) {
    return NextResponse.json({ error: "Réservé à la direction et aux chefs d'équipe." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Numéro de tournée et service requis." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tour_routes")
    .insert({ organization_id: appUser.organization_id, tour_number: parsed.data.tour_number, service_id: parsed.data.service_id })
    .select("id")
    .single();
  if (error) {
    const duplicate = error.code === "23505";
    return NextResponse.json({ error: duplicate ? "Cette tournée existe déjà." : error.message }, { status: duplicate ? 409 : 500 });
  }
  return NextResponse.json({ id: data.id });
}
