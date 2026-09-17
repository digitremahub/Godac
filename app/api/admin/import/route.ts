import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { bulkImportVehiclesAndDrivers } from "@/lib/organization/bulk-import";
import { vehicleCsvRowSchema, driverCsvRowSchema } from "@/lib/utils/csv";

const bodySchema = z.object({
  vehicles: z.array(vehicleCsvRowSchema).default([]),
  drivers: z.array(driverCsvRowSchema).default([]),
});

/**
 * Ongoing (post-onboarding) bulk import — same logic as
 * app/api/onboarding/import/route.ts, but reachable any time from
 * Admin > Import instead of only during the one-time signup wizard,
 * for a company that adds a batch of vehicles/drivers later.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut importer en masse" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  try {
    const result = await bulkImportVehiclesAndDrivers(
      supabase,
      appUser.organization_id,
      parsed.data.vehicles,
      parsed.data.drivers,
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur import" }, { status: 500 });
  }
}
