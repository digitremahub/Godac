import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, aujourdhuiParis } from "@/lib/colis/serveur";
import { choixRegroupement, ficheDeLAffectation } from "@/lib/colis/fiche-du-jour";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";

const roles = ["direction", "manager"];
const schema = z.object({
  service_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  tour_number: z.string().trim().min(1).max(60),
  date: z.string().date(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  /**
   * Le chauffeur a déjà une autre affectation ou une fiche ouverte ce jour-là :
   * fiches colis séparées (recommandé) ou reliées en une seule tournée.
   * Absent dans ce cas : réponse 409 `choix_requis` sans rien inscrire.
   */
  regroupement: z.enum(["separee", "reliee"]).optional(),
});

/**
 * Affecter une tournée : entrée de planning ET fiche Tournée colis du
 * chauffeur (lib/colis/fiche-du-jour.ts) : une fiche par affectation
 * (séparée, par défaut) ou, exceptionnellement, reliée à sa fiche ouverte
 * du jour. Le chauffeur la retrouve prête, villages et ramasses compris.
 */
export async function GET() {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const user = g.appUser;
  if (!roles.includes(user.role)) return NextResponse.json({ error: "Accès réservé à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const [{ data: services, error: servicesError }, { data: drivers, error: driversError }, { data: vehicles, error: vehiclesError }, { data: routes, error: routesError }] = await Promise.all([
    supabase.from("services").select("id,name").eq("organization_id", user.organization_id).order("name"),
    supabase.from("users").select("id,full_name").eq("organization_id", user.organization_id).eq("active", true).or(FILTRE_CONDUCTEURS).order("full_name"),
    supabase.from("vehicles").select("id,registration,service_id").eq("organization_id", user.organization_id).order("registration"),
    supabase.from("tour_routes").select("id,tour_number,service_id").eq("organization_id", user.organization_id).order("tour_number"),
  ]);
  const error = servicesError ?? driversError ?? vehiclesError ?? routesError;
  if (error) return NextResponse.json({ error: "Impossible de charger les services, chauffeurs, véhicules ou tournées existantes." }, { status: 500 });
  const tours = (routes ?? []).map((r: any) => ({ id: r.id, tour_number: r.tour_number, service_id: r.service_id }));
  return NextResponse.json({ services: services ?? [], drivers: drivers ?? [], vehicles: vehicles ?? [], tours, today: aujourdhuiParis() });
}

export async function POST(req: Request) {
  const g2 = await garderApi({ modules: ["route_optimizer"] });
  if (!g2.ok) return g2.reponse;
  const user = g2.appUser;
  if (!roles.includes(user.role)) return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d'équipe peut affecter une tournée." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });

  const { service_id, driver_id, vehicle_id, tour_number, date, time, regroupement } = parsed.data;
  const [{ data: driver }, { data: vehicle }, { data: service }, { data: route }] = await Promise.all([
    supabase.from("users").select("id").eq("id", driver_id).eq("organization_id", user.organization_id).eq("active", true).or(FILTRE_CONDUCTEURS).maybeSingle(),
    supabase.from("vehicles").select("id,service_id").eq("id", vehicle_id).eq("organization_id", user.organization_id).maybeSingle(),
    supabase.from("services").select("id").eq("id", service_id).eq("organization_id", user.organization_id).maybeSingle(),
    supabase.from("tour_routes").select("id").eq("organization_id", user.organization_id).eq("service_id", service_id).eq("tour_number", tour_number).maybeSingle(),
  ]);

  if (!driver || !vehicle || !service || !route || (vehicle.service_id && vehicle.service_id !== service_id)) {
    return NextResponse.json({ error: "Choisissez une tournée modèle existante et un chauffeur, service et véhicule valides pour cette organisation." }, { status: 400 });
  }

  const start_at = parisWallTimeToUtcISOString(date, time);
  const conducteur = { id: driver_id, organization_id: user.organization_id };
  const avecFiche = date >= aujourdhuiParis();

  // Autre affectation ou fiche ouverte ce jour-là : demander séparées ou
  // reliées avant d'inscrire quoi que ce soit (plusieurs affectations dans
  // la journée restent normales, jamais bloquées).
  if (avecFiche && !regroupement) {
    try {
      const choix = await choixRegroupement(supabase, conducteur, date);
      if (choix?.requis) {
        return NextResponse.json({ choix_requis: true, existantes: choix.existantes, fiches_ouvertes: choix.fiches_ouvertes }, { status: 409 });
      }
    } catch (e) {
      console.warn("[colis/affectations] Choix séparée/reliée non vérifié", { driverId: driver_id, date, error: e instanceof Error ? e.message : e });
    }
  }

  const { data: assignment, error } = await supabase.from("planning_entries").insert({
    organization_id: user.organization_id,
    service_id,
    driver_id,
    vehicle_id,
    tour_number,
    start_at,
    status: "planned",
  }).select("id,organization_id,service_id,driver_id,vehicle_id,tour_number,start_at,status,created_at").single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Cette tournée est déjà affectée à ce créneau pour ce service." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const warning = await warnIfDriverDoubleBooked(supabase, {
    organizationId: user.organization_id,
    driverId: driver_id,
    startAt: start_at,
    excludeEntryId: assignment.id,
  });

  // Fiche colis du chauffeur (jour même ou à venir). Un échec ici n'annule
  // pas l'affectation : le chauffeur peut toujours créer sa fiche lui-même.
  let fiche: { id: string; name: string | null } | null = null;
  let ficheWarning: string | null = null;
  if (avecFiche) {
    try {
      const r = await ficheDeLAffectation(supabase, conducteur, assignment, date, regroupement ?? "separee");
      fiche = { id: r.run.id, name: r.run.name ?? null };
      ficheWarning = r.warning ?? null;
    } catch (e) {
      console.error("[colis/affectations] Fiche colis non créée", { driverId: driver_id, date, error: e instanceof Error ? e.message : e });
      ficheWarning = "Tournée inscrite au planning, mais la fiche Tournée colis n'a pas pu être préparée : le chauffeur peut la créer avec « Nouvelle tournée ».";
    }
  }

  return NextResponse.json({ assignment, fiche, warning: [warning, ficheWarning].filter(Boolean).join(" ") || null }, { status: 201 });
}
