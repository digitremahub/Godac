import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/clerk/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  status: z.enum(["scheduled", "in_progress", "done", "cancelled"]).optional(),
  completed_at: z.string().datetime().nullable().optional(),
  cost: z.coerce.number().nonnegative().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vehicle_interventions")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ intervention: data });
}
