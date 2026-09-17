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

/** Onboarding step 2 (Module 1): see lib/organization/bulk-import.ts for the shared logic. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();

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
