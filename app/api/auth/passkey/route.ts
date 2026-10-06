import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Lists the signed-in user's own registered passkeys — RLS ("webauthn_credentials: read own") already scopes this. */
export async function GET() {
  await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("webauthn_credentials")
    .select("id, device_name, created_at, last_used_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ credentials: data ?? [] });
}
