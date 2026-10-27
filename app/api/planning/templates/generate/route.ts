import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays, parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { minuitParis } from "@/lib/ticpe/export";
import { cleCreneau } from "@/lib/planning/cle-creneau";
import { noterModificationPlanning } from "@/lib/planning/suivi-auto-serveur";
import { verrouDe } from "@/lib/planning/fusion-verrou";
import { verrousDeLaPeriode } from "@/lib/planning/fusion-verrou-serveur";

const schema = z.object({
  week_start: z.string().date(),
  service_id: z.string().uuid(),
  template_ids: z.array(z.string().uuid()).optional(),
});

const allowedRoles = ["direction", "manager", "exploitation"];

/**
 * Génère les affectations planifiées depuis les modèles actifs.
 * Ne remplace jamais un créneau existant : les affectations déjà
 * éditées manuellement restent prioritaires. Une tournée d'origine d'une fusion
 * ce jour-là (lib/planning/fusion-verrou.ts) n'est pas générée : case
 * verrouillée, comptée dans `fusionnees`.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!allowedRoles.includes(appUser.role)) {
    return NextResponse.json({ error: "Seule la Direction ou un responsable autorisé peut générer le planning." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { week_start, service_id, template_ids } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const { data: service, error: serviceError } = await supabase
    .from("services").select("id").eq("id", service_id).eq("organization_id", appUser.organization_id).maybeSingle();
  if (serviceError) return NextResponse.json({ error: serviceError.message }, { status: 500 });
  if (!service) return NextResponse.json({ error: "Service introuvable dans votre organisation." }, { status: 404 });

  const { data: templates, error: templateError } = await supabase
    .from("planning_tour_templates")
    .select("id, service_id, route_id, departure_time, weekdays, default_vehicle_id, tour_routes(tour_number)")
    .eq("organization_id", appUser.organization_id)
    .eq("service_id", service_id)
    .eq("active", true);
  if (templateError) return NextResponse.json({ error: "Impossible de charger les modèles. Vérifiez la migration planning_tour_templates." }, { status: 503 });

  const selected = (templates ?? []).filter((t: any) => !template_ids || template_ids.includes(t.id));
  if (template_ids && selected.length !== new Set(template_ids).size) {
    return NextResponse.json({ error: "Un ou plusieurs modèles sont introuvables, inactifs ou rattachés à un autre service." }, { status: 400 });
  }
  if (!selected.length) return NextResponse.json({ created: 0, skipped: 0, message: "Aucun modèle actif à générer." });

  const { data: existing, error: existingError } = await supabase
    .from("planning_entries")
    .select("service_id, tour_number, start_at")
    .eq("organization_id", appUser.organization_id)
    .eq("service_id", service_id)
    // Semaine en heure de Paris (lundi 00:00 → lundi suivant 00:00).
    .gte("start_at", minuitParis(week_start))
    .lt("start_at", minuitParis(addDays(week_start, 7)));
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const occupied = new Set((existing ?? []).map((e) => cleCreneau(e.service_id, e.tour_number, e.start_at)));
  // Tournées fermées sans chauffeur (ne roulent pas ce jour-là) : jamais régénérées, même si l'heure du modèle a changé.
  // Lecture tolérante : sans la colonne tour_open (migration 20261105000002), aucune fermeture.
  const { data: fermees } = await supabase
    .from("planning_entries")
    .select("tour_number, start_at")
    .eq("organization_id", appUser.organization_id)
    .eq("service_id", service_id)
    .eq("tour_open", false)
    .is("driver_id", null)
    .gte("start_at", minuitParis(week_start))
    .lt("start_at", minuitParis(addDays(week_start, 7)));
  const joursFermes = new Set((fermees ?? []).map((e) => `${e.tour_number}|${parisCalendarDate(e.start_at)}`));
  // Tournées d'origine d'une fusion cette semaine : jamais générées (lecture tolérante : sans la migration, aucune).
  const { verrous } = await verrousDeLaPeriode(supabase, appUser.organization_id, service_id, week_start, addDays(week_start, 6));
  const rows: any[] = [];
  let skipped = 0;
  let fusionnees = 0;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const day = addDays(week_start, dayOffset);
    // Monday=1 ... Sunday=0, matching the weekday values stored by templates.
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    for (const template of selected as any[]) {
      if (!(template.weekdays ?? []).includes(weekday)) continue;
      const route = Array.isArray(template.tour_routes) ? template.tour_routes[0] : template.tour_routes;
      if (!route?.tour_number) continue;
      if (verrouDe(verrous, service_id, route.tour_number, day)) {
        fusionnees++;
        continue;
      }
      const start_at = parisWallTimeToUtcISOString(day, String(template.departure_time).slice(0, 5));
      const key = cleCreneau(service_id, route.tour_number, start_at);
      if (occupied.has(key) || joursFermes.has(`${route.tour_number}|${day}`)) {
        skipped++;
        continue;
      }
      occupied.add(key);
      rows.push({
        organization_id: appUser.organization_id,
        service_id,
        tour_number: route.tour_number,
        driver_id: null,
        vehicle_id: template.default_vehicle_id ?? null,
        start_at,
        status: "planned",
      });
    }
  }

  if (!rows.length) return NextResponse.json({ created: 0, skipped, fusionnees, message: "Aucune nouvelle affectation à créer : les créneaux sont déjà présents ou aucun modèle ne correspond aux jours sélectionnés." });

  // Créneau créé en parallèle : ignoré (contrainte unique organisation,
  // service, tournée, départ), jamais remplacé.
  const { data: inserted, error: insertError } = await supabase
    .from("planning_entries")
    .upsert(rows, { onConflict: "organization_id,service_id,tour_number,start_at", ignoreDuplicates: true })
    .select("id, service_id, tour_number, start_at");
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  skipped += rows.length - (inserted?.length ?? 0);
  if (inserted?.length) await noterModificationPlanning(appUser.organization_id, [{ serviceId: service_id, jour: week_start }]);

  return NextResponse.json({ created: inserted?.length ?? 0, skipped, fusionnees });
}
