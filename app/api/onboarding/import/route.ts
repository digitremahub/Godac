import { NextResponse } from "next/server";
import { garderApi, refus } from "@/lib/acces/garde-api";
import { controlerAjoutVehicules } from "@/lib/acces/limites-serveur";
import { z } from "zod";
import { bulkImportVehiclesAndDrivers } from "@/lib/organization/bulk-import";
import { rolesImportRefuses } from "@/lib/organization/roles-import";
import { vehicleCsvRowSchema, driverCsvRowSchema } from "@/lib/utils/csv";

const bodySchema = z.object({
  vehicles: z.array(vehicleCsvRowSchema).max(500).default([]),
  drivers: z.array(driverCsvRowSchema).max(500).default([]),
});

/**
 * Onboarding step 2 (Module 1): see lib/organization/bulk-import.ts for the shared logic.
 * Réservé à la direction et à l'exploitation ; chacun n'invite que les rôles
 * qu'il peut attribuer (lib/roles/perimetre.ts) et le quota de véhicules de
 * la formule bloque l'import.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "exploitation"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const interdits = rolesImportRefuses(appUser.role, parsed.data.drivers);
  if (interdits.length > 0) {
    return refus("ROLE_REFUSE", `Vous ne pouvez pas inviter ce rôle : ${interdits.join(", ")}.`, { rolesAutorises: ["chauffeur", "manager"] });
  }

  const limite = await controlerAjoutVehicules(
    appUser.organization_id,
    parsed.data.vehicles.map((v) => String(v.registration ?? "")),
  );
  if (!limite.ok) return refus("LIMITE_FORMULE", limite.message, { utilise: limite.limite.utilise, inclus: limite.limite.inclus ?? undefined });

  try {
    const result = await bulkImportVehiclesAndDrivers(
      g.supabase,
      appUser.organization_id,
      parsed.data.vehicles,
      parsed.data.drivers,
    );
    return NextResponse.json({ ...result, avertissement: limite.avertissement });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur import" }, { status: 500 });
  }
}
