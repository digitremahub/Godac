import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Leaves the demo for the real sign-up (middleware would bounce a signed-in visitor off /sign-up). */
export async function GET(req: Request) {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/sign-up", new URL(req.url).origin));
}
