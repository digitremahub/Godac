import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getVehicleLatestKmReading } from "@/lib/vehicles/odometer-reference";
import { parisCalendarDate } from "@/lib/planning/dates";
import { daysUntil, endDateAlertDue, evaluateKmAllowance, formatKm, KM_LEVEL_LABELS } from "@/lib/rental/contract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vrai si l'alerte (véhicule, type, référence) n'a encore jamais été émise — dédoublonnage. */
async function firstTime(admin: SupabaseClient, organizationId: string, vehicleId: string, kind: string, ref: string): Promise<boolean> {
  const { data } = await admin
    .from("rental_contract_alert_log")
    .upsert({ organization_id: organizationId, vehicle_id: vehicleId, kind, ref }, { onConflict: "vehicle_id,kind,ref", ignoreDuplicates: true })
    .select("id");
  return (data?.length ?? 0) > 0;
}

/**
 * Cron quotidien du module « Véhicules loués » (vercel.json) — même
 * contrôle CRON_SECRET que les autres crons. Pour chaque véhicule loué :
 *  - fin de contrat dans 30 jours ou moins → alerte (une fois par date de fin) ;
 *  - forfait kilométrique : dépassement prévu au prorata, 90 % atteints,
 *    forfait dépassé → alerte (une fois par niveau et par contrat).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const today = parisCalendarDate(new Date().toISOString());

  const { data: orgs } = await admin.from("organization_modules").select("organization_id").eq("module_key", "rental_providers").eq("enabled", true);
  const orgIds = (orgs ?? []).map((o) => o.organization_id as string);
  if (orgIds.length === 0) return NextResponse.json({ ok: true, alerts: 0 });

  const { data: vehicles } = await admin
    .from("vehicles")
    .select("id, organization_id, service_id, registration, ownership, rental_end_date, rental_start_date, rental_km_allowance, rental_start_km, rental_providers(name)")
    .in("organization_id", orgIds)
    .neq("ownership", "propre")
    .neq("status", "out_of_service");

  let created = 0;
  for (const v of (vehicles ?? []) as any[]) {
    const provider = v.rental_providers?.name ? ` (${v.rental_providers.name})` : "";
    const base = {
      organization_id: v.organization_id,
      type: "rental_contract",
      related_table: "vehicles",
      related_id: v.id,
      recipient_roles: ["manager", "manager_chauffeur", "direction"],
      service_id: v.service_id ?? null,
    };

    if (v.rental_end_date && endDateAlertDue(v.rental_end_date, today) && (await firstTime(admin, v.organization_id, v.id, "fin_contrat", v.rental_end_date))) {
      const days = daysUntil(v.rental_end_date, today);
      const date = new Date(`${v.rental_end_date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      await admin.from("alerts").insert({
        ...base,
        severity: days <= 7 ? "critical" : "warning",
        message: `Fin du contrat de location de ${v.registration}${provider} le ${date} (dans ${days} jour${days > 1 ? "s" : ""}) : restitution ou prolongation à prévoir.`,
      });
      created++;
    }

    if (v.rental_km_allowance && v.rental_start_date && v.rental_end_date && v.rental_start_km != null) {
      const km = await getVehicleLatestKmReading(admin, v.id);
      if (!km) continue;
      const res = evaluateKmAllowance({
        allowanceKm: Number(v.rental_km_allowance),
        startDate: v.rental_start_date,
        endDate: v.rental_end_date,
        startKm: Number(v.rental_start_km),
        currentKm: km.km,
        today,
      });
      if (!res || res.level === "ok") continue;
      const ref = `${v.rental_start_date}|${v.rental_end_date}|${v.rental_km_allowance}|${res.level}`;
      if (!(await firstTime(admin, v.organization_id, v.id, "forfait_km", ref))) continue;
      await admin.from("alerts").insert({
        ...base,
        severity: res.level === "depasse" ? "critical" : "warning",
        message: `${KM_LEVEL_LABELS[res.level]} pour ${v.registration}${provider} : ${formatKm(res.drivenKm)} parcourus sur ${formatKm(Number(v.rental_km_allowance))} (prorata à date ${formatKm(res.prorataKm)}, projection fin de contrat ${formatKm(res.projectedKm)}).`,
      });
      created++;
    }
  }

  return NextResponse.json({ ok: true, vehicles: vehicles?.length ?? 0, alerts: created });
}
