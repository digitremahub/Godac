import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Rotates the org's self-signup link (app/join/[token]) — the only
 * real mitigation if it's shared somewhere it shouldn't be, since
 * anyone holding the old link can no longer create pending accounts
 * with it once this runs. RLS ("org: direction can update their own
 * org") already restricts this to direction, so the regular
 * session-scoped client is enough — no admin client needed.
 */
export async function POST() {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut régénérer ce lien." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const token = randomUUID();
  const { error } = await supabase.from("organizations").update({ driver_signup_token: token }).eq("id", appUser.organization_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ token });
}
