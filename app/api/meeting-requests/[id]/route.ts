import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  status: z.enum(["scheduled", "declined", "done"]),
  scheduled_at: z.string().datetime().optional(),
});

/** Only manager-like/direction advance a request's status — RLS ("meeting_requests: manager-like updates") is the real gate. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("meeting_requests")
    .update({
      status: parsed.data.status,
      scheduled_at: parsed.data.scheduled_at ?? null,
      handled_by: appUser.id,
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}
