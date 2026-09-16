import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inviteOrganizationMember } from "@/lib/auth/invitations";
import { vehicleCsvRowSchema, driverCsvRowSchema } from "@/lib/utils/csv";

const bodySchema = z.object({
  vehicles: z.array(vehicleCsvRowSchema).default([]),
  drivers: z.array(driverCsvRowSchema).default([]),
});

/**
 * Onboarding step 2 (Module 1): bulk-creates vehicles directly, and
 * sends Supabase Auth invitations for drivers/managers — driver
 * accounts can't be inserted straight into `users` because that row
 * is keyed by a real Supabase Auth user id, which only exists once
 * the invitee accepts (see lib/auth/provisioning.ts).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { vehicles, drivers } = parsed.data;

  const supabase = await createServerSupabaseClient();

  const serviceNames = new Set(
    [...vehicles.map((v) => v.service), ...drivers.map((d) => d.service)].filter(Boolean),
  );
  const serviceIdByName = new Map<string, string>();

  for (const name of serviceNames) {
    const { data: existing } = await supabase
      .from("services")
      .select("id")
      .eq("organization_id", appUser.organization_id)
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      serviceIdByName.set(name, existing.id);
      continue;
    }

    const { data: created, error } = await supabase
      .from("services")
      .insert({ organization_id: appUser.organization_id, name })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: `Impossible de créer le service "${name}": ${error.message}` }, { status: 500 });
    }
    serviceIdByName.set(name, created.id);
  }

  let insertedVehicles = 0;
  if (vehicles.length > 0) {
    const { error, count } = await supabase
      .from("vehicles")
      .insert(
        vehicles.map((v) => ({
          organization_id: appUser.organization_id,
          registration: v.registration,
          type: v.type,
          tank_capacity_liters: v.tank_capacity_liters ?? null,
          service_id: v.service ? serviceIdByName.get(v.service) ?? null : null,
        })),
        { count: "exact" },
      );
    if (error) {
      return NextResponse.json({ error: `Import véhicules échoué: ${error.message}` }, { status: 500 });
    }
    insertedVehicles = count ?? vehicles.length;
  }

  const invitationResults = await Promise.allSettled(
    drivers.map((d) =>
      inviteOrganizationMember({
        email: d.email,
        fullName: d.full_name,
        role: d.role,
        organizationId: appUser.organization_id,
        serviceId: d.service ? serviceIdByName.get(d.service) : undefined,
      }),
    ),
  );

  const invitationFailures = invitationResults
    .map((res, i) => ({ res, email: drivers[i]?.email }))
    .filter((x): x is { res: PromiseRejectedResult; email: string } => x.res.status === "rejected")
    .map((x) => ({ email: x.email, error: String(x.res.reason) }));

  return NextResponse.json({
    insertedVehicles,
    invitationsSent: invitationResults.length - invitationFailures.length,
    invitationFailures,
  });
}
