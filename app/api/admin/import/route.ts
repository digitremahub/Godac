import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { refus } from "@/lib/acces/garde-api";
import { controlerAjoutVehicules } from "@/lib/acces/limites-serveur";
import { z } from "zod";
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
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut importer en masse" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const limite = await controlerAjoutVehicules(
    appUser.organization_id,
    parsed.data.vehicles.map((v) => String(v.registration ?? "")),
  );
  if (!limite.ok) return refus("LIMITE_FORMULE", limite.message, { utilise: limite.limite.utilise, inclus: limite.limite.inclus ?? undefined });

  const supabase = await createServerSupabaseClient();
  try {
    const result = await bulkImportVehiclesAndDrivers(
      supabase,
      appUser.organization_id,
      parsed.data.vehicles,
      parsed.data.drivers,
    );
    return NextResponse.json({ ...result, avertissement: limite.avertissement });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur import" }, { status: 500 });
  }
}
