import { startAuthentication } from "@simplewebauthn/browser";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/**
 * Shared by DriverPinFlow and AuthForm — both just need "does this
 * account have a passkey on this device, and if so, try it", then
 * fall back to their own normal flow (PIN / magic link) on any
 * failure, per the explicit "additive, never instead of" requirement.
 * Redeems the one-time token from ../../app/api/auth/passkey/login/verify
 * via verifyOtp to get a real Supabase session, exactly like clicking
 * a magic-link email would.
 */
export async function tryPasskeyLogin(identify: { user_id?: string; email?: string }): Promise<{ attempted: boolean }> {
  const optionsRes = await fetch("/api/auth/passkey/login/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(identify),
  });
  const optionsJson = await optionsRes.json();
  if (!optionsRes.ok || !optionsJson.available) {
    return { attempted: false };
  }

  const assertion = await startAuthentication({ optionsJSON: optionsJson.options });

  const verifyRes = await fetch("/api/auth/passkey/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response: assertion }),
  });
  const verifyJson = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(typeof verifyJson.error === "string" ? verifyJson.error : "Connexion impossible");

  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ email: verifyJson.email, token: verifyJson.token, type: "magiclink" });
  if (error) throw error;

  return { attempted: true };
}
