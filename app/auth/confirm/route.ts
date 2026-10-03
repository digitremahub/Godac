import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Lands here after an invite / magic-link / password-reset / email-change
 * link click, verifying the token_hash server-side via verifyOtp. Unlike
 * app/auth/callback/route.ts's ?code= exchange (PKCE — needs a
 * code_verifier stored in the browser that started the flow), this needs
 * nothing from the browser, so it works when the link is opened on a
 * different device/browser than the one that requested it — the normal
 * case for an email link. Requires the corresponding Supabase Auth email
 * template to link here with token_hash/type/next instead of the default
 * {{ .ConfirmationURL }} (see README's Supabase setup section).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? `${origin}/dashboard`;

  if (token_hash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Covers an email-change confirmation link landing here just like
      // any other: public.users.email is a plain copy set at
      // invite/onboarding time, never auto-synced from auth.users, so it
      // would otherwise go stale the moment a change is confirmed.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email) {
        await supabase.from("users").update({ email: user.email }).eq("id", user.id).neq("email", user.email);
      }
      return NextResponse.redirect(next);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_confirm_failed`);
}
