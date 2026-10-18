import { startAuthentication } from "@simplewebauthn/browser";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export async function tryPasskeyLogin(identify: { user_id?: string; email?: string }): Promise<{ attempted: boolean }> {
  const optionsRes = await fetch("/api/auth/passkey/login/options", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identify),
  });
  const optionsJson = await optionsRes.json().catch(() => null);
  if (!optionsRes.ok) throw new Error(typeof optionsJson?.error === "string" ? optionsJson.error : `Le serveur de connexion a répondu avec une erreur (${optionsRes.status}). Réessayez ou utilisez votre badge + PIN.`);
  if (!optionsJson || !optionsJson.available) return { attempted: false };

  const assertion = await startAuthentication({ optionsJSON: optionsJson.options });
  const verifyRes = await fetch("/api/auth/passkey/login/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response: assertion }),
  });
  const verifyJson = await verifyRes.json().catch(() => null);
  if (!verifyRes.ok) throw new Error(typeof verifyJson?.error === "string" ? verifyJson.error : `La vérification Face ID a échoué (réponse serveur ${verifyRes.status}). Utilisez votre badge + PIN.`);
  if (!verifyJson?.email || !verifyJson?.token) throw new Error("Réponse de connexion incomplète. Utilisez votre badge + PIN ou réessayez.");
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ email: verifyJson.email, token: verifyJson.token, type: "magiclink" });
  if (error) throw error;
  return { attempted: true };
}