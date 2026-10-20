import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/planning/dates";
import { lignesPresence } from "@/lib/planning/presence-bureau";
import { PRESENCE_STATUS, estPoleBureau } from "@/lib/organization/poles";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ajouter"),
    service_id: z.string().uuid(),
    user_id: z.string().uuid(),
    week_start: z.string().date(),
    days: z.array(z.number().int().min(0).max(6)).min(1),
    start: z.string(),
    end: z.string(),
  }),
  z.object({
    action: z.literal("copier_semaine"),
    service_id: z.string().uuid(),
    source_week_start: z.string().date(),
    target_week_start: z.string().date(),
  }),
]);

/**
 * Planning de présence d'un pôle bureau (secrétariat, comptabilité…) :
 * horaires d'arrivée/départ par personne et par jour, sans véhicule ni
 * tournée (lib/planning/presence-bureau.ts). Même droits que le
 * planning des tournées — RLS « planning: manager-like writes scoped
 * to service » : la direction partout, un manager sur les pôles
 * auxquels il est rattaché.
 *
 * Réécrire un jour déjà planifié à la même heure d'arrivée remplace
 * l'heure de départ (upsert sur la contrainte unique de la table).
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour planifier." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: service } = await supabase.from("services").select("id, pole").eq("id", parsed.data.service_id).maybeSingle();
  if (!service) return NextResponse.json({ error: "Pôle introuvable." }, { status: 404 });
  if (!estPoleBureau(service.pole)) {
    return NextResponse.json({ error: "Le planning de présence concerne les pôles bureau ; les services d'exploitation se planifient en tournées." }, { status: 400 });
  }

  let lignes;
  if (parsed.data.action === "ajouter") {
    // RLS users : ne renvoie que les membres de l'organisation.
    const { data: personne } = await supabase.from("users").select("id").eq("id", parsed.data.user_id).maybeSingle();
    if (!personne) return NextResponse.json({ error: "Personne introuvable dans l'organisation." }, { status: 404 });
    const r = lignesPresence({
      organizationId: appUser.organization_id,
      serviceId: service.id,
      userId: parsed.data.user_id,
      weekStart: parsed.data.week_start,
      jours: parsed.data.days,
      debut: parsed.data.start,
      fin: parsed.data.end,
    });
    if (!r.ok) return NextResponse.json({ error: r.erreur }, { status: 400 });
    lignes = r.lignes;
  } else {
    const { source_week_start, target_week_start } = parsed.data;
    const { data: source, error } = await supabase
      .from("planning_entries")
      .select("driver_id, tour_number, start_at, end_at")
      .eq("service_id", service.id)
      .eq("status", PRESENCE_STATUS)
      .gte("start_at", `${addDays(source_week_start, -1)}T00:00:00Z`)
      .lt("start_at", `${addDays(source_week_start, 8)}T00:00:00Z`);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const decalage = Date.parse(`${target_week_start}T00:00:00Z`) - Date.parse(`${source_week_start}T00:00:00Z`);
    const debutSource = Date.parse(`${source_week_start}T00:00:00Z`) - 3 * 3_600_000;
    const finSource = Date.parse(`${addDays(source_week_start, 7)}T00:00:00Z`) - 3 * 3_600_000;
    // Décalage en jours entiers : une présence de 8 h reste à 8 h, sauf
    // changement d'heure entre les deux semaines (décalage d'une heure, rare).
    lignes = (source ?? [])
      .filter((e) => e.driver_id && e.end_at && Date.parse(e.start_at) >= debutSource && Date.parse(e.start_at) < finSource)
      .map((e) => ({
        organization_id: appUser.organization_id,
        service_id: service.id,
        driver_id: e.driver_id,
        tour_number: e.tour_number,
        kind: "presence",
        status: PRESENCE_STATUS,
        vehicle_id: null,
        start_at: new Date(Date.parse(e.start_at) + decalage).toISOString(),
        end_at: new Date(Date.parse(e.end_at!) + decalage).toISOString(),
      }));
    if (lignes.length === 0) return NextResponse.json({ created: 0 });
  }

  const { data, error } = await supabase
    .from("planning_entries")
    .upsert(lignes, { onConflict: "organization_id,service_id,tour_number,start_at" })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ created: data?.length ?? 0 });
}
