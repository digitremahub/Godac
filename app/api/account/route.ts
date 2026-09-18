import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({ full_name: z.string().min(1) });

/**
 * Self-service profile edit — unlike app/api/admin/users/[id], which
 * only direction can call (and for any user), this only ever touches
 * the signed-in user's own row, so no role gate is needed beyond
 * being authenticated. RLS ("users: self update") is the real backstop.
 */
export async function PATCH(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("users").update({ full_name: parsed.data.full_name }).eq("id", appUser.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
