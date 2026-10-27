import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { plannedDuplicates } from "@/lib/planning/duplicates";
import { noterModificationPlanning } from "@/lib/planning/suivi-auto-serveur";

/**
 * Direction (or exploitation, whole organisation) removal of a duplicated planned entry. The duplicate
 * is re-checked here against the driver's entries around that day —
 * the button alone is never trusted, and a tour that ran is never
 * deletable (plannedDuplicates only flags `planned` rows).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction" && appUser.role !== "exploitation") {
    return NextResponse.json({ error: "Réservé à la direction et à l'exploitation." }, { status: 403 });
  }
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: target } = await supabase
    .from("planning_entries")
    .select("id, driver_id, service_id, start_at")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (!target?.driver_id) return NextResponse.json({ error: "Affectation introuvable." }, { status: 404 });

  const around = (h: number) => new Date(new Date(target.start_at).getTime() + h * 3600_000).toISOString();
  const { data: neighbours } = await supabase
    .from("planning_entries")
    .select("id, driver_id, tour_number, start_at, status, created_at")
    .eq("organization_id", appUser.organization_id)
    .eq("driver_id", target.driver_id)
    .gte("start_at", around(-30))
    .lt("start_at", around(30));

  if (!plannedDuplicates(neighbours ?? []).some((d) => d.entry.id === id)) {
    return NextResponse.json({ error: "Cette affectation n'est pas un doublon." }, { status: 409 });
  }

  const { error } = await supabase.from("planning_entries").delete().eq("id", id).eq("status", "planned");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await noterModificationPlanning(appUser.organization_id, [{ serviceId: target.service_id as string, startAt: target.start_at as string }]);
  return NextResponse.json({ ok: true });
}
