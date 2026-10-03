import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Legacy/fallback handler for a ?code= PKCE exchange (e.g. an OAuth
 * provider sign-in on the same browser that started it). Every email
 * link (magic link, invite, password reset, email change) now points to
 * app/auth/confirm/route.ts instead — PKCE needs a code_verifier stored
 * in the browser that initiated the flow, which an email link opened on
 * a different device/browser never has.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Covers an email-change confirmation link landing here just
      // like any other: public.users.email is a plain copy set at
      // invite/onboarding time, never auto-synced from auth.users, so
      // it would otherwise go stale the moment a change is confirmed.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email) {
        await supabase.from("users").update({ email: user.email }).eq("id", user.id).neq("email", user.email);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`);
}
