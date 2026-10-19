import { garderApi, refus } from "@/lib/acces/garde-api";
import { controlerAjoutVehicules } from "@/lib/acces/limites-serveur";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const specSourceEntrySchema = z.object({ origin: z.literal("ia"), confirmed: z.boolean() });

const bodySchema = z.object({
  registration: z.string().min(1),
  type: z.enum(["VL", "PL", "SPL"]),
  tank_capacity_liters: z.coerce.number().positive().optional(),
  service_id: z.string().uuid().optional().nullable(),
  initial_km: z.coerce.number().min(0),
  brand: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  model_year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
  gearbox: z.string().optional(),
  fuel_type: z.string().optional(),
  adblue_capacity_liters: z.coerce.number().positive().optional(),
  ptac_kg: z.coerce.number().positive().optional(),
  reference_consumption_l_100km: z.coerce.number().positive().optional(),
  spec_sources: z.record(z.string(), specSourceEntrySchema).optional(),
});

export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "manager", "manager_chauffeur"], modules: ["fleet"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Limite de la formule (décision client Q8) : avertissement à 100 %,
  // refus au-delà de 110 % des véhicules inclus.
  const limite = await controlerAjoutVehicules(appUser.organization_id, [parsed.data.registration]);
  if (!limite.ok) return refus("LIMITE_FORMULE", limite.message, { utilise: limite.limite.utilise, inclus: limite.limite.inclus ?? undefined });

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vehicles")
    .insert({ organization_id: appUser.organization_id, ...parsed.data })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vehicle: data, avertissement: limite.avertissement });
}
