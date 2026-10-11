import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { computeDriverCodeBase } from "@/lib/business/driver-code";

const bodySchema = z.object({
  role: z.enum(["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"]).optional(),
  role_title: z.string().nullable().optional(),
  active: z.boolean().optional(),
  full_name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  // Richer replacement for service_id above — several qualified
  // services per driver, each with its own status (titulaire/
  // formation/remplacement). Sent by DriverServicesPanel; service_id
  // stays for the admin table's quick single-service edit. Only one
  // of the two is expected per request.
  services: z
    .array(z.object({ service_id: z.string().uuid(), status: z.enum(["titulaire", "formation", "remplacement"]) }))
    .optional(),
  // Lot 7: forgets their PIN → direction clears it, next badge scan
  // offers "créez votre code" again instead of "entrez votre code".
  reset_pin: z.boolean().optional(),
  // Données du contrat, lues par la direction — le taux horaire s'en
  // déduit (lib/business/payroll.ts), voir /payroll.
  monthly_gross_salary: z.number().min(0).max(999999.99).nullable().optional(),
  monthly_net_salary: z.number().min(0).max(999999.99).nullable().optional(),
  contractual_monthly_hours: z.number().positive().max(999.99).optional(),
  // Dossier RH (employee_files) — profil complet visible direction
  // uniquement, voir app/(dashboard)/admin/users/[id]/page.tsx.
  // hr_status n'accepte que 'active'/'suspended'/'terminated' ici :
  // 'on_leave' est dérivé par compute_hr_status() à partir des congés
  // approuvés, jamais saisi à la main (voir 20260101000017).
  contract_type: z.enum(["cdi", "cdd", "interim", "apprentissage"]).nullable().optional(),
  hire_date: z.string().nullable().optional(),
  contract_end_date: z.string().nullable().optional(),
  hr_status: z.enum(["active", "suspended", "terminated"]).optional(),
  hr_notes: z.string().nullable().optional(),
  // Déclenche le recalcul du code de secours (users.driver_code) en
  // "initiales + mois/année" dès qu'elle est renseignée — voir
  // assignDriverCodeFromBirthDate ci-dessous.
  birth_date: z.string().nullable().optional(),
});

/**
 * Recalcule le code de secours d'un chauffeur en "initiales +
 * mois/année de naissance" (ex: FT11/88) et le pose sur `users`,
 * avec un suffixe numérique si une collision existe déjà dans
 * l'organisation (deux chauffeurs aux mêmes initiales et au même
 * mois/année de naissance) — rare mais pas impossible, et la colonne
 * reste unique par organisation (20260101000056).
 */
async function assignDriverCodeFromBirthDate(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  fullName: string,
  birthDateISO: string,
) {
  const base = computeDriverCodeBase(fullName, birthDateISO);
  let candidate = base;
  let suffix = 2;
  // Au plus une poignée d'organisations auront jamais plus de 1-2
  // collisions réelles — une boucle bornée évite simplement un cas
  // pathologique de données corrompues de tourner indéfiniment.
  for (let attempt = 0; attempt < 50; attempt++) {
    const { data: conflict } = await supabase
      .from("users")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("driver_code", candidate)
      .neq("id", userId)
      .maybeSingle();
    if (!conflict) break;
    candidate = `${base}-${suffix++}`;
  }
  await supabase.from("users").update({ driver_code: candidate }).eq("id", userId);
}

/**
 * Role changes are a plain update to `public.users.role` — nothing
 * external to keep in sync now that GODAC's 5 roles live only in our
 * own table (see supabase/migrations/20260101000002_core_tables.sql).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut modifier les rôles" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Guard against locking an organisation out of its own admin
  // panel: since only `direction` can change roles or deactivate
  // accounts, demoting or deactivating the last `direction` account
  // (including your own) would leave nobody able to undo it from the UI.
  const demotesOrDeactivates = (parsed.data.role && parsed.data.role !== "direction") || parsed.data.active === false;
  if (demotesOrDeactivates) {
    const { data: target } = await supabase.from("users").select("role").eq("id", id).single();
    if (target?.role === "direction") {
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", appUser.organization_id)
        .eq("role", "direction")
        .eq("active", true);
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Impossible de retirer ou désactiver le dernier compte direction de l'organisation." },
          { status: 409 },
        );
      }
    }
  }

  const {
    service_id,
    services,
    reset_pin,
    monthly_gross_salary,
    monthly_net_salary,
    contractual_monthly_hours,
    contract_type,
    hire_date,
    contract_end_date,
    hr_status,
    hr_notes,
    birth_date,
    ...userFields
  } = parsed.data;
  const updateFields: Record<string, unknown> = { ...userFields };

  if (reset_pin) {
    const { data: target } = await supabase.from("users").select("auth_method").eq("id", id).single();
    if (target?.auth_method !== "pin") {
      return NextResponse.json({ error: "Ce compte ne se connecte pas par code PIN." }, { status: 409 });
    }
    updateFields.pin_set_at = null;
  }

  let targetUser: { id: string; role: string } | null = null;
  if (Object.keys(updateFields).length > 0) {
    const { data, error } = await supabase.from("users").update(updateFields).eq("id", id).select("id, role, role_title").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    targetUser = data;
  }

  if (services !== undefined) {
    // Full replace: a driver qualified on several services, each with
    // its own status (titulaire/formation/remplacement) — see
    // DriverServicesPanel.
    const { error: clearError } = await supabase.from("user_services").delete().eq("user_id", id);
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });
    if (services.length > 0) {
      const { error: insertError } = await supabase
        .from("user_services")
        .insert(services.map((s) => ({ user_id: id, service_id: s.service_id, status: s.status })));
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  } else if (service_id !== undefined) {
    // A user has at most one service through the admin table's quick
    // edit — replace rather than accumulate rows in the underlying
    // many-to-many table.
    const { error: clearError } = await supabase.from("user_services").delete().eq("user_id", id);
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });
    if (service_id) {
      const { error: linkError } = await supabase.from("user_services").insert({ user_id: id, service_id });
      if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
    }
  }

  if (monthly_gross_salary !== undefined || monthly_net_salary !== undefined || contractual_monthly_hours !== undefined) {
    // Separate table (user_contracts), not `users` — RLS on `users`
    // lets any org member read any row (legitimate for a name/phone/
    // role, not for a salary); see 20260101000077.
    const contractFields: Record<string, unknown> = { user_id: id, updated_at: new Date().toISOString() };
    if (monthly_gross_salary !== undefined) contractFields.monthly_gross_salary = monthly_gross_salary;
    if (monthly_net_salary !== undefined) contractFields.monthly_net_salary = monthly_net_salary;
    if (contractual_monthly_hours !== undefined) contractFields.contractual_monthly_hours = contractual_monthly_hours;
    const { error: contractError } = await supabase.from("user_contracts").upsert(contractFields, { onConflict: "user_id" });
    if (contractError) return NextResponse.json({ error: contractError.message }, { status: 500 });
  }

  if (
    contract_type !== undefined ||
    hire_date !== undefined ||
    contract_end_date !== undefined ||
    hr_status !== undefined ||
    hr_notes !== undefined ||
    birth_date !== undefined
  ) {
    const employeeFileFields: Record<string, unknown> = { organization_id: appUser.organization_id, user_id: id };
    if (contract_type !== undefined) employeeFileFields.contract_type = contract_type;
    if (hire_date !== undefined) employeeFileFields.hire_date = hire_date;
    if (contract_end_date !== undefined) employeeFileFields.contract_end_date = contract_end_date;
    if (hr_status !== undefined) employeeFileFields.hr_status = hr_status;
    if (hr_notes !== undefined) employeeFileFields.notes = hr_notes;
    if (birth_date !== undefined) employeeFileFields.birth_date = birth_date;
    const { error: employeeFileError } = await supabase.from("employee_files").upsert(employeeFileFields, { onConflict: "user_id" });
    if (employeeFileError) return NextResponse.json({ error: employeeFileError.message }, { status: 500 });

    if (birth_date) {
      // full_name peut venir d'être changé dans la même requête (userFields.full_name)
      // ou être simplement celui déjà en base — toujours relu pour éviter de se fier à
      // un `targetUser` dont le select ne porte pas forcément sur full_name.
      const { data: userRow } = await supabase.from("users").select("full_name").eq("id", id).single();
      if (userRow?.full_name) await assignDriverCodeFromBirthDate(supabase, appUser.organization_id, id, userRow.full_name, birth_date);
    }
  }

  return NextResponse.json({ user: targetUser ?? { id } });
}
