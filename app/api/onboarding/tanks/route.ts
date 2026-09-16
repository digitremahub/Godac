import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
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
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", orgId)
    .single();

  if (orgError || !organization) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
  }

  const { error, count } = await supabase.from("tanks").insert(
    parsed.data.tanks.map((t) => ({
      organization_id: organization.id,
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
