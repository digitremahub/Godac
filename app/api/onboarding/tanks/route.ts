import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  tanks: z
    .array(
      z.object({
        name: z.string().min(1),
        fuel_type: z.enum(["diesel", "adblue"]),
        capacity_liters: z.coerce.number().positive(),
        current_totalizer_index: z.coerce.number().min(0).default(0),
      }),
    )
    .min(1),
});

/** Onboarding step 3 (Module 1): configure the tenant's fuel tanks. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error, count } = await supabase.from("tanks").insert(
    parsed.data.tanks.map((t) => ({
      organization_id: appUser.organization_id,
      name: t.name,
      fuel_type: t.fuel_type,
      capacity_liters: t.capacity_liters,
      current_totalizer_index: t.current_totalizer_index,
    })),
    { count: "exact" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ insertedTanks: count ?? parsed.data.tanks.length });
}
