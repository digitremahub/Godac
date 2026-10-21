import "server-only";
import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addDays, parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { seedModulesRecents, supprimerFichiersDemo } from "@/lib/demo/seed-modules";

/**
 * Mode démo — « Transports Démo », a fictional carrier a prospect can
 * open in one click from the public site (/demo). Everything is built
 * through the real tables, so the database's own triggers compute PMP,
 * tank stock and alerts exactly as for a customer. Dates are relative
 * to "now": the demo always shows the last three weeks and today.
 *
 * organizations.is_demo switches off outbound effects (alert emails and
 * push, invitations, billing — see lib/demo/guard.ts). Rebuilt nightly
 * by /api/cron/reset-demo. Les modules récents (Tournée colis, modèles du
 * planning, paie transport, écarts carburant) sont construits par
 * lib/demo/seed-modules.ts, de façon tolérante.
 */

export const DEMO_DOMAIN = "demo.godac.app";
export const DEMO_ACCOUNTS = {
  direction: `direction@${DEMO_DOMAIN}`,
  chauffeur: `chauffeur@${DEMO_DOMAIN}`,
} as const;
export type DemoPersona = keyof typeof DEMO_ACCOUNTS;

/** Deterministic, never displayed: re-applied before every demo sign-in. */
export function demoPassword(email: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant.");
  return createHmac("sha256", key).update(`godac:demo:${email}`).digest("base64url").slice(0, 32);
}

// Small seeded PRNG so a reset always produces the same-looking data.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const MODULES = [
  // La démo publique reste un sous-ensemble représentatif : le socle
  // carburant/flotte, plus les nouveautés mises en avant sur le site
  // (Tournée colis + GO Navigation, Planning, Paie transport, Congés).
  "fleet",
  "fuel_tracking",
  "planning",
  "ticpe_export",
  "route_optimizer",
  "payslips",
  "leave_management",
];

const PEOPLE = [
  { key: "direction", email: DEMO_ACCOUNTS.direction, full_name: "Sophie Martin", role: "direction", role_title: "Gérante" },
  { key: "manager", email: `exploitation@${DEMO_DOMAIN}`, full_name: "Julien Roux", role: "manager", role_title: "Responsable d'exploitation" },
  { key: "karim", email: DEMO_ACCOUNTS.chauffeur, full_name: "Karim Benali", role: "chauffeur", role_title: null },
  { key: "lucas", email: `lucas@${DEMO_DOMAIN}`, full_name: "Lucas Durand", role: "chauffeur", role_title: null },
  { key: "nadia", email: `nadia@${DEMO_DOMAIN}`, full_name: "Nadia Rahmani", role: "chauffeur", role_title: null },
  { key: "thomas", email: `thomas@${DEMO_DOMAIN}`, full_name: "Thomas Garcia", role: "chauffeur", role_title: null },
  { key: "mehdi", email: `mehdi@${DEMO_DOMAIN}`, full_name: "Mehdi Haddad", role: "chauffeur", role_title: null },
  { key: "elodie", email: `elodie@${DEMO_DOMAIN}`, full_name: "Élodie Fabre", role: "chauffeur", role_title: null },
] as const;

const VEHICLES = [
  { registration: "FH-123-AB", type: "PL", brand: "Renault Trucks", model: "D Wide", service: 0, driver: "karim", km: 184200 },
  { registration: "GK-456-CD", type: "PL", brand: "Mercedes-Benz", model: "Atego", service: 0, driver: "lucas", km: 126900 },
  { registration: "HZ-789-EF", type: "PL", brand: "DAF", model: "XB", service: 0, driver: "nadia", km: 98400 },
  { registration: "JL-321-GH", type: "SPL", brand: "Volvo", model: "FH 460", service: 1, driver: "thomas", km: 412300 },
  { registration: "KM-654-IJ", type: "PL", brand: "Iveco", model: "Eurocargo", service: 1, driver: "mehdi", km: 151700 },
  { registration: "LN-987-KL", type: "PL", brand: "MAN", model: "TGL", service: 1, driver: "elodie", km: 73200 },
  { registration: "MP-147-MN", type: "VL", brand: "Renault", model: "Master", service: 0, driver: null, km: 58300 },
  { registration: "NQ-258-OP", type: "VL", brand: "Peugeot", model: "Boxer", service: 1, driver: null, km: 91100 },
] as const;

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(`Démo — ${what} : ${error.message}`);
  return data as NonNullable<T>;
}

async function deleteDemoAuthUsers(admin: SupabaseClient) {
  for (let page = 1; page <= 5; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email?.endsWith(`@${DEMO_DOMAIN}`)) await admin.auth.admin.deleteUser(u.id);
    }
    if (users.length < 200) break;
  }
}

/** Removes the demo organization and its accounts. Tables with ON DELETE RESTRICT to users/vehicles/tanks go first. */
export async function teardownDemo(admin: SupabaseClient = createAdminSupabaseClient()) {
  const { data: orgs } = await admin.from("organizations").select("id").eq("is_demo", true);
  for (const org of orgs ?? []) {
    await supprimerFichiersDemo(admin, org.id);
    // fuel_gap_reviews.created_by est ON DELETE RESTRICT vers users.
    for (const table of ["fuel_gap_reviews", "fuel_entries", "vehicle_washes", "ticpe_exports"]) {
      await admin.from(table).delete().eq("organization_id", org.id);
    }
    await must(admin.from("organizations").delete().eq("id", org.id), "suppression de l'organisation");
  }
  await deleteDemoAuthUsers(admin);
}

/** Returns the demo organization id, building it if it doesn't exist yet. */
export async function ensureDemo(): Promise<string> {
  const admin = createAdminSupabaseClient();
  const { data: existing } = await admin.from("organizations").select("id").eq("is_demo", true).maybeSingle();
  if (existing) {
    const { count } = await admin.from("users").select("id", { count: "exact", head: true }).eq("organization_id", existing.id);
    if ((count ?? 0) >= PEOPLE.length) {
      // Public demo intentionally exposes only a limited representative subset.
      // Disable modules outside the allow-list for existing demo organizations too.
      const { error: disableError } = await admin
        .from("organization_modules")
        .update({ enabled: false })
        .eq("organization_id", existing.id)
        .not("module_key", "in", `(${MODULES.join(",")})`);
      if (disableError) throw new Error(`Démo — limitation des modules : ${disableError.message}`);
      const { error: enableError } = await admin
        .from("organization_modules")
        .upsert(
          MODULES.map((module_key) => ({ organization_id: existing.id, module_key, enabled: true })),
          { onConflict: "organization_id,module_key" },
        );
      if (enableError) throw new Error(`Démo — activation des modules autorisés : ${enableError.message}`);
      return existing.id;
    }
    await teardownDemo(admin); // half-built (interrupted) — start over
  }
  return seedDemo(admin);
}

export async function seedDemo(admin: SupabaseClient = createAdminSupabaseClient()): Promise<string> {
  await deleteDemoAuthUsers(admin);
  const rand = rng(20261012);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
  const between = (a: number, b: number) => a + rand() * (b - a);

  const org = await must(
    admin
      .from("organizations")
      .insert({
        name: "Transports Démo",
        is_demo: true,
        depot_address: "12 rue du Dépôt, 69007 Lyon",
        depot_lat: 45.7286,
        depot_lng: 4.8324,
        consumption_anomaly_threshold_percent: 20,
      })
      .select("id")
      .single(),
    "organisation",
  );
  const orgId = org.id as string;

  await must(
    admin.from("organization_modules").insert(MODULES.map((module_key) => ({ organization_id: orgId, module_key, enabled: true }))),
    "modules",
  );

  const services = await must(
    admin
      .from("services")
      .insert([
        { organization_id: orgId, name: "Messagerie Lyon Sud", code: "LYS", depot_address: "12 rue du Dépôt, 69007 Lyon", depot_lat: 45.7286, depot_lng: 4.8324 },
        { organization_id: orgId, name: "Express Valence", code: "VAL", depot_address: "4 avenue de Romans, 26000 Valence", depot_lat: 44.9334, depot_lng: 4.8924 },
      ])
      .select("id, name"),
    "services",
  );

  // Accounts (public.users.id IS the auth id).
  const userIds: Record<string, string> = {};
  for (const p of PEOPLE) {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password: demoPassword(p.email),
      email_confirm: true,
      user_metadata: { full_name: p.full_name, demo: true },
    });
    if (error || !data.user) throw new Error(`Démo — compte ${p.email} : ${error?.message}`);
    userIds[p.key] = data.user.id;
  }
  await must(
    admin.from("users").upsert(
      PEOPLE.map((p) => ({
        id: userIds[p.key],
        organization_id: orgId,
        role: p.role,
        role_title: p.role_title,
        full_name: p.full_name,
        email: p.email,
        phone: "06 00 00 00 00",
        monthly_gross_salary: p.role === "chauffeur" ? 2350 : null,
        monthly_net_salary: p.role === "chauffeur" ? 1840 : null,
      })),
    ),
    "utilisateurs",
  );
  const drivers = PEOPLE.filter((p) => p.role === "chauffeur");
  await must(
    admin.from("user_services").insert([
      ...drivers.map((d, i) => ({ user_id: userIds[d.key], service_id: services[i < 3 ? 0 : 1]!.id })),
      { user_id: userIds.manager, service_id: services[0]!.id },
      { user_id: userIds.manager, service_id: services[1]!.id },
    ]),
    "affectations",
  );

  const vehicles = await must(
    admin
      .from("vehicles")
      .insert(
        VEHICLES.map((v) => ({
          organization_id: orgId,
          service_id: services[v.service]!.id,
          registration: v.registration,
          type: v.type,
          brand: v.brand,
          model: v.model,
          initial_km: v.km,
          tank_capacity_liters: v.type === "VL" ? 80 : v.type === "SPL" ? 600 : 300,
          reference_consumption_l_100km: v.type === "VL" ? 9.5 : v.type === "SPL" ? 31 : 24,
          assigned_driver_id: v.driver ? userIds[v.driver] : null,
          fuel_type: "Gazole",
        })),
      )
      .select("id, registration"),
    "véhicules",
  );
  const vehicleByDriver: Record<string, { id: string; registration: string }> = {};
  VEHICLES.forEach((v, i) => {
    if (v.driver) vehicleByDriver[v.driver] = vehicles[i]!;
  });

  // Fuel: a depot tank, two deliveries (they set the PMP), then
  // fill-ups in time order with a continuous totalizer.
  const tank = await must(
    admin
      .from("tanks")
      .insert({ organization_id: orgId, service_id: services[0]!.id, name: "Cuve gazole — Lyon Sud", fuel_type: "diesel", capacity_liters: 20000, current_totalizer_index: 125000 })
      .select("id")
      .single(),
    "cuve",
  );
  const today = parisCalendarDate(new Date().toISOString());
  const at = (day: string, time: string) => parisWallTimeToUtcISOString(day, time);
  await must(
    admin.from("tank_deliveries").insert([
      { organization_id: orgId, tank_id: tank.id, liters: 14000, unit_price: 1.512, supplier: "Total Energies Pro", delivered_at: at(addDays(today, -24), "09:30"), recorded_by: userIds.manager },
      { organization_id: orgId, tank_id: tank.id, liters: 9000, unit_price: 1.468, supplier: "Total Energies Pro", delivered_at: at(addDays(today, -9), "10:15"), recorded_by: userIds.manager },
    ]),
    "livraisons",
  );

  // Tours: every weekday of the last three weeks, one per driver.
  const km: Record<string, number> = Object.fromEntries(VEHICLES.filter((v) => v.driver).map((v) => [v.driver!, v.km]));
  const tours: Record<string, unknown>[] = [];
  const fuel: { occurred_at: string; driver: string; liters: number; vehicle_km: number }[] = [];
  for (let d = -21; d <= 5; d++) {
    const day = addDays(today, d);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    drivers.forEach((drv, i) => {
      const veh = vehicleByDriver[drv.key]!;
      const service = services[i < 3 ? 0 : 1]!;
      const startTime = `06:${String(Math.floor(between(0, 45))).padStart(2, "0")}`;
      const base = { organization_id: orgId, service_id: service.id, driver_id: userIds[drv.key], vehicle_id: veh.id, tour_number: `${service.name.startsWith("Mess") ? "L" : "V"}${100 + i}` };
      if (d > 0) {
        tours.push({ ...base, start_at: at(day, startTime), status: "planned" });
        return;
      }
      if (d === 0) {
        // Today: most drivers out on tour, one (Élodie) on leave.
        if (drv.key === "elodie") return;
        tours.push({ ...base, start_at: at(day, startTime), status: "in_progress", start_km: km[drv.key], start_vehicle_ok: true });
        return;
      }
      const distance = Math.round(between(120, 260));
      const startKm = km[drv.key]!;
      km[drv.key] = startKm + distance;
      const endTime = `${Math.floor(between(14, 17))}:${String(Math.floor(between(0, 59))).padStart(2, "0")}`;
      tours.push({
        ...base,
        start_at: at(day, startTime),
        end_at: at(day, endTime),
        status: "done",
        start_km: startKm,
        end_km: startKm + distance,
        start_vehicle_ok: true,
        end_vehicle_ok: true,
        return_type: "depot",
        report_stops_total: Math.round(between(28, 52)),
        report_stops_delivered: Math.round(between(26, 50)),
        report_packages_count: Math.round(between(90, 180)),
      });
      if (rand() < 0.42 && d > -21) fuel.push({ occurred_at: at(day, endTime), driver: drv.key, liters: Math.round(between(150, 290) * 10) / 10, vehicle_km: startKm + distance });
    });
  }
  const affectations = await must(admin.from("planning_entries").insert(tours).select("id, driver_id, start_at, status, tour_number"), "tournées");

  fuel.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  let totalizer = 125000;
  // Trois pleins avec un écart de totaliseur (litres sortis de la cuve
  // sans plein saisi) : un traité, un expliqué par le chauffeur, un à traiter.
  const retenus = fuel.filter((f) => f.occurred_at >= at(addDays(today, -24), "10:00"));
  const rangsEcart = new Set([3, Math.floor(retenus.length / 2), retenus.length - 2].filter((r) => r > 0));
  const pleinsAvecEcart: { id: string; driver: string }[] = [];
  for (const [rang, f] of retenus.entries()) {
    const ecart = rangsEcart.has(rang);
    if (ecart) totalizer = Math.round((totalizer + 12.4 + rang / 10) * 10) / 10;
    const before = totalizer;
    totalizer = Math.round((totalizer + f.liters) * 10) / 10;
    const plein = await must(
      admin.from("fuel_entries").insert({
        organization_id: orgId,
        vehicle_id: vehicleByDriver[f.driver]!.id,
        driver_id: userIds[f.driver],
        created_by: userIds[f.driver],
        tank_id: tank.id,
        occurred_at: f.occurred_at,
        totalizer_before: before,
        totalizer_after: totalizer,
        liters: f.liters,
        unit_price: f.occurred_at < at(addDays(today, -9), "10:15") ? 1.512 : 1.49,
        vehicle_km: f.vehicle_km,
        status: "manual",
      }).select("id").single(),
      "plein",
    );
    if (ecart) pleinsAvecEcart.push({ id: plein.id as string, driver: f.driver });
  }

  const vid = (reg: string) => vehicles.find((v) => v.registration === reg)!.id;
  await must(
    admin.from("vehicle_interventions").insert([
      { organization_id: orgId, vehicle_id: vid("GK-456-CD"), type: "Vidange + filtres", description: "Entretien des 130 000 km", status: "scheduled", urgency: "normal", scheduled_at: at(addDays(today, 3), "08:00"), category: "maintenance", requested_by: userIds.manager },
      { organization_id: orgId, vehicle_id: vid("JL-321-GH"), type: "Pneu avant droit usé", description: "Usure irrégulière signalée au retour de tournée", status: "in_progress", urgency: "high", category: "tires", requested_by: userIds.thomas },
      { organization_id: orgId, vehicle_id: vid("FH-123-AB"), type: "Plaquettes de frein", status: "done", urgency: "normal", completed_at: at(addDays(today, -6), "16:00"), cost: 418.5, category: "mechanical", requested_by: userIds.karim },
    ]),
    "entretiens",
  );

  await must(
    admin.from("leave_requests").insert([
      { organization_id: orgId, driver_id: userIds.elodie, service_id: services[1]!.id, start_date: today, end_date: addDays(today, 2), status: "approved", reason: "Congés payés", decided_by: userIds.direction, decided_at: at(addDays(today, -10), "11:00"), replacement_driver_id: userIds.mehdi },
      { organization_id: orgId, driver_id: userIds.lucas, service_id: services[0]!.id, start_date: addDays(today, 14), end_date: addDays(today, 18), status: "pending", reason: "Congés payés" },
    ]),
    "congés",
  );

  await seedModulesRecents({ admin, orgId, userIds, services, vehicleByDriver, today, at, affectations, pleinsAvecEcart });

  return orgId;
}

/** Shown on the public site and in the demo banner. */
export function pickDemoPersona(value: string | null | undefined): DemoPersona {
  return value === "chauffeur" ? "chauffeur" : "direction";
}

