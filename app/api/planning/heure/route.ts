import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { changementsHeure, HEURE_VALIDE, modelesDeLaTournee } from "@/lib/planning/heure";
import { voitToutLOrganisation } from "@/lib/roles/perimetre";
import type { AffectationPlanning } from "@/lib/planning/semaine";
import { noterModificationPlanning } from "@/lib/planning/suivi-auto-serveur";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  tour_number: z.string().trim().min(1).max(60),
  heure: z.string().regex(HEURE_VALIDE),
  /**
   * « periode » : les affectations prévues de la tournée entre `debut` et
   * `fin` (jours de Paris, inclus) ; un seul jour : debut = fin.
   * « modele » : heure de départ des modèles de planning de la tournée
   * (prochaines générations ; les affectations déjà posées ne bougent pas).
   */
  portee: z.enum(["periode", "modele"]),
  debut: z.string().date().optional(),
  fin: z.string().date().optional(),
});

/**
 * Changer l'heure de départ d'une tournée depuis le planning
 * (components/planning/FeuilleHeure.tsx). Le chauffeur d'une affectation
 * modifiée est prévenu par le trigger de publication (changement d'heure
 * = « modif » : à la prochaine publication, ou tout de suite pour
 * aujourd'hui et demain). Une affectation déjà démarrée ne change pas.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!["direction", "manager", "exploitation"].includes(appUser.role)) {
    return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d’équipe peut changer l'heure d'une tournée." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { service_id, tour_number, heure, portee } = parsed.data;
  const supabase = await createServerSupabaseClient();

  if (!voitToutLOrganisation(appUser.role)) {
    const { data: lien } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id).eq("service_id", service_id).maybeSingle();
    if (!lien) return NextResponse.json({ error: "Ce service ne fait pas partie de vos services autorisés." }, { status: 403 });
  }

  if (portee === "modele") {
    const { data, error } = await supabase
      .from("planning_tour_templates")
      .select("id, service_id, tour_routes(tour_number)")
      .eq("organization_id", appUser.organization_id)
      .eq("service_id", service_id)
      .eq("active", true);
    if (error) return NextResponse.json({ error: "Impossible de lire les modèles de planning." }, { status: 503 });
    const modeles = modelesDeLaTournee(
      ((data ?? []) as any[]).filter((m) => m.tour_routes?.tour_number).map((m) => ({ id: m.id as string, service_id: m.service_id as string, tour_number: m.tour_routes.tour_number as string })),
      service_id,
      tour_number,
    );
    if (!modeles.length) return NextResponse.json({ error: "Cette tournée n'a pas de modèle de planning : choisissez « Seulement ce jour » ou une période." }, { status: 404 });
    const { error: majError } = await supabase
      .from("planning_tour_templates")
      .update({ departure_time: heure })
      .in("id", modeles.map((m) => m.id))
      .eq("organization_id", appUser.organization_id);
    if (majError) return NextResponse.json({ error: majError.message }, { status: 500 });
    return NextResponse.json({ modifiees: 0, prevenus: 0, conflits: 0, modeles: modeles.length });
  }

  const { debut, fin } = parsed.data;
  if (!debut || !fin || debut > fin) return NextResponse.json({ error: "Période invalide." }, { status: 400 });
  const { data: entrees, error: lectureError } = await supabase
    .from("planning_entries")
    .select("id, service_id, tour_number, driver_id, vehicle_id, start_at, status")
    .eq("organization_id", appUser.organization_id)
    .eq("service_id", service_id)
    .eq("tour_number", tour_number)
    .eq("status", "planned")
    // Marge d'un jour : instants UTC, regroupés par jour de Paris.
    .gte("start_at", `${addDays(debut, -1)}T00:00:00Z`)
    .lt("start_at", `${addDays(fin, 2)}T00:00:00Z`);
  if (lectureError) return NextResponse.json({ error: lectureError.message }, { status: 500 });

  const changements = changementsHeure((entrees ?? []) as AffectationPlanning[], { serviceId: service_id, tourNumber: tour_number, debut, fin, heure, versUtc: parisWallTimeToUtcISOString });
  let modifiees = 0;
  let prevenus = 0;
  let conflits = 0;
  for (const c of changements) {
    const { data, error } = await supabase.from("planning_entries").update({ start_at: c.nouveauStartAt }).eq("id", c.entree.id).eq("status", "planned").select("id").maybeSingle();
    if (error) {
      if (error.code === "23505") {
        conflits++;
        continue;
      }
      return NextResponse.json({ error: error.message, modifiees }, { status: 500 });
    }
    if (!data) continue;
    modifiees++;
    if (c.prevenir) prevenus++;
  }
  if (modifiees > 0) await noterModificationPlanning(appUser.organization_id, [{ serviceId: service_id, jour: debut }, { serviceId: service_id, jour: fin }]);
  return NextResponse.json({ modifiees, prevenus, conflits, modeles: 0 });
}
