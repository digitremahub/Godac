import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  reason: z.string().min(1),
  preferred_date: z.string().date().optional(),
});

/** Intranet: any member can request a meeting, naming themselves — RLS ("meeting_requests: any member requests") is the real gate. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("meeting_requests")
    .insert({
      organization_id: appUser.organization_id,
      requested_by: appUser.id,
      reason: parsed.data.reason,
      preferred_date: parsed.data.preferred_date || null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}
