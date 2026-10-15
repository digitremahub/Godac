import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { creerTournee, listerTournees, moduleActif } from "@/lib/colis/serveur";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";

/** Tournées colis du chauffeur connecté (jour en cours + non clôturées de la semaine). */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  return NextResponse.json({ tournees: await listerTournees(supabase, appUser) });
}

const bodySchema = z.object({
  name: z.string().trim().max(60).nullable().optional(),
  service_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  vehicle_id: z.string().uuid().optional(),
  date: z.string().date().optional(),
  time: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/).optional(),
  tour_number: z.string().trim().min(1).max(40).optional(),
}).superRefine((body, ctx) => {
  const assignment = [body.service_id, body.driver_id, body.vehicle_id, body.date, body.time, body.tour_number];
  if (assignment.some(Boolean) && !assignment.every(Boolean)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pour affecter une tournée, renseignez le service, le chauffeur, le véhicule, la date, l'heure et le numéro." });
  }
});

/** Crée une tournée chauffeur ou synchronise une affectation Planning + Tournée colis. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Requête invalide." }, { status: 400 });

  const body = parsed.data;
  if (body.service_id && body.driver_id && body.vehicle_id && body.date && body.time && body.tour_number) {
    if (!["direction", "manager", "manager_chauffeur"].includes(appUser.role)) {
      return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d’équipe peut affecter une tournée." }, { status: 403 });
    }
    const startAt = parisWallTimeToUtcISOString(body.date, body.time);
    const runDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(startAt));
    const { data: service } = await supabase.from("services").select("id").eq("id", body.service_id).eq("organization_id", appUser.organization_id).maybeSingle();
    const { data: driver } = await supabase.from("users").select("id, role").eq("id", body.driver_id).eq("organization_id", appUser.organization_id).eq("active", true).maybeSingle();
    const { data: vehicle } = await supabase.from("vehicles").select("id, service_id").eq("id", body.vehicle_id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!service || !driver || !["chauffeur", "manager_chauffeur"].includes(driver.role) || !vehicle) {
      return NextResponse.json({ error: "Service, chauffeur ou véhicule invalide pour cette organisation." }, { status: 400 });
    }
    if (vehicle.service_id && vehicle.service_id !== body.service_id) {
      return NextResponse.json({ error: "Le véhicule n'est pas rattaché au service choisi." }, { status: 400 });
    }
    const { data: qualification } = await supabase.from("user_services").select("service_id").eq("user_id", body.driver_id).eq("service_id", body.service_id).maybeSingle();
    if (!qualification) return NextResponse.json({ error: "Ce chauffeur n'est pas affecté à ce service." }, { status: 400 });

    const { data: planning, error: planningError } = await supabase.from("planning_entries").insert({
      organization_id: appUser.organization_id,
      service_id: body.service_id,
      tour_number: body.tour_number,
      driver_id: body.driver_id,
      vehicle_id: body.vehicle_id,
      start_at: startAt,
      status: "planned",
    }).select("id").single();
    if (planningError) {
      if (planningError.code === "23505") return NextResponse.json({ error: "Une affectation existe déjà pour ce service, ce numéro de tournée et cette date/heure." }, { status: 409 });
      return NextResponse.json({ error: planningError.message }, { status: 500 });
    }

    const runName = `Tournée ${body.tour_number}`;
    const { data: existingRun } = await supabase.from("delivery_runs").select("id").eq("organization_id", appUser.organization_id).eq("driver_id", body.driver_id).eq("run_date", runDate).eq("name", runName).maybeSingle();
    if (existingRun) {
      await supabase.from("planning_entries").delete().eq("id", planning.id).eq("status", "planned");
      return NextResponse.json({ error: "Une tournée colis porte déjà ce numéro pour ce chauffeur à cette date." }, { status: 409 });
    }
    const { data: run, error: runError } = await supabase.from("delivery_runs").insert({
      organization_id: appUser.organization_id,
      driver_id: body.driver_id,
      vehicle_id: body.vehicle_id,
      service_id: body.service_id,
      run_date: runDate,
      name: runName,
      planned_start: body.time,
    }).select("id, name, run_date, status, planned_start").single();
    if (runError) {
      await supabase.from("planning_entries").delete().eq("id", planning.id).eq("status", "planned");
      return NextResponse.json({ error: `Affectation Planning annulée : création de la tournée colis impossible (${runError.message}).` }, { status: 500 });
    }
    return NextResponse.json({ run, planning_entry_id: planning.id, synchronized: true }, { status: 201 });
  }

  try {
    return NextResponse.json({ run: await creerTournee(supabase, appUser, body.name ?? null) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création impossible" }, { status: 500 });
  }
}
