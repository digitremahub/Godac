import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DEMO_ACCOUNTS, demoPassword, ensureDemo, pickDemoPersona } from "@/lib/demo/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * « Voir la démo » — signs the visitor into the fictional « Transports
 * Démo » organization, as the direction or as a driver (?as=chauffeur).
 * The demo is built on first use (lib/demo/seed.ts) and rebuilt nightly.
 * The account's email and password are re-applied before every sign-in,
 * so a visitor who changed them can't lock the next one out.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const persona = pickDemoPersona(url.searchParams.get("as"));
  const email = DEMO_ACCOUNTS[persona];

  try {
    await ensureDemo();
    const admin = createAdminSupabaseClient();
    const { data: profile } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!profile) throw new Error("compte de démo introuvable");
    await admin.auth.admin.updateUserById(profile.id, { email, password: demoPassword(email), email_confirm: true });

    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
    const { error } = await supabase.auth.signInWithPassword({ email, password: demoPassword(email) });
    if (error) throw error;
  } catch (e) {
    console.error("demo sign-in failed", e);
    return NextResponse.redirect(new URL("/?demo=indisponible", url.origin));
  }

  return NextResponse.redirect(new URL("/dashboard", url.origin));
}
