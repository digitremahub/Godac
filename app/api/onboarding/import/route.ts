import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inviteOrganizationMember } from "@/lib/clerk/invitations";
import { vehicleCsvRowSchema, driverCsvRowSchema } from "@/lib/utils/csv";

const bodySchema = z.object({
  vehicles: z.array(vehicleCsvRowSchema).default([]),
  drivers: z.array(driverCsvRowSchema).default([]),
});

/**
 * Onboarding step 2 (Module 1): bulk-creates vehicles directly, and
 * sends Clerk organisation invitations for drivers/managers — driver
 * accounts can't be inserted straight into `users` because that table
 * requires a real clerk_user_id, which only exists once the invitee
 * accepts (see app/api/webhooks/clerk/route.ts).
 */
export async function POST(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { vehicles, drivers } = parsed.data;

  const supabase = createServerSupabaseClient();
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", orgId)
    .single();

  if (orgError || !organization) {
    return NextResponse.json(
      { error: "Organisation introuvable côté GODAC. Le webhook Clerk a-t-il bien synchronisé la création ?" },
      { status: 409 },
    );
  }

  const serviceNames = new Set(
    [...vehicles.map((v) => v.service), ...drivers.map((d) => d.service)].filter(Boolean),
  );
  const serviceIdByName = new Map<string, string>();

  for (const name of serviceNames) {
    const { data: existing } = await supabase
      .from("services")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      serviceIdByName.set(name, existing.id);
      continue;
    }

    const { data: created, error } = await supabase
      .from("services")
      .insert({ organization_id: organization.id, name })
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
          organization_id: organization.id,
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
        clerkOrgId: orgId,
        email: d.email,
        role: d.role,
        serviceId: d.service ? serviceIdByName.get(d.service) : undefined,
        inviterUserId: userId,
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
