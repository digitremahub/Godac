import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Lands here after a magic-link / invite email click. Exchanges the
 * one-time `code` for a real session (stored in cookies by
 * lib/supabase/server.ts), then continues to `next` — the dashboard
 * layout takes it from there (auto-provisioning an invited user, or
 * sending an organic sign-up to /onboarding).
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
