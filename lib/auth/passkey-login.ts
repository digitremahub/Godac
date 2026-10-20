import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { ErreurServeurPasskey, texteErreurServeur } from "@/lib/auth/passkey-erreurs";

/**
 * Connexion Face ID / empreinte. `identify` vide : clé « découvrable »,
 * le téléphone propose les clés qu'il détient pour ce site, sans e-mail.
 * Les échecs remontent avec leur code (ErreurServeurPasskey, ou l'erreur
 * du navigateur : NotAllowedError, SecurityError…) pour
 * expliquerErreurPasskey.
 */
export async function tryPasskeyLogin(identify: { user_id?: string; email?: string } = {}): Promise<{ attempted: boolean }> {
  if (!browserSupportsWebAuthn()) {
    const e = new Error("WebAuthn indisponible dans ce navigateur");
    e.name = "NonPrisEnCharge";
    throw e;
  }
  const corps = { ...(identify.user_id ? { user_id: identify.user_id } : {}), ...(identify.email?.trim() ? { email: identify.email.trim().toLowerCase() } : {}) };
  const optionsRes = await fetch("/api/auth/passkey/login/options", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), credentials: "same-origin",
  });
  const optionsJson = await optionsRes.json().catch(() => null);
  if (!optionsRes.ok) {
    const { message, code } = texteErreurServeur(optionsJson, optionsRes.status, "Le serveur de connexion a répondu avec une erreur.");
    throw new ErreurServeurPasskey(message, code, optionsRes.status);
  }
  if (!optionsJson || !optionsJson.available) return { attempted: false };

  const assertion = await startAuthentication({ optionsJSON: optionsJson.options });
  const verifyRes = await fetch("/api/auth/passkey/login/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response: assertion }), credentials: "same-origin",
  });
  const verifyJson = await verifyRes.json().catch(() => null);
  if (!verifyRes.ok) {
    const { message, code } = texteErreurServeur(verifyJson, verifyRes.status, "La vérification de la clé a échoué.");
    throw new ErreurServeurPasskey(message, code, verifyRes.status);
  }
  if (!verifyJson?.token) throw new ErreurServeurPasskey("Réponse de connexion incomplète.", "reponse_incomplete", verifyRes.status);

  const supabase = createBrowserSupabaseClient();
  // Jeton haché du lien magique (generateLink) : il se valide en
  // token_hash. « email » est le type recommandé par supabase-js 2.x ;
  // « magiclink » (ancien nom) en repli — un échec ne consomme pas le jeton.
  let { error } = await supabase.auth.verifyOtp({ token_hash: verifyJson.token, type: "email" });
  if (error) {
    const repli = await supabase.auth.verifyOtp({ token_hash: verifyJson.token, type: "magiclink" });
    if (!repli.error) error = null;
  }
  if (error) throw error;
  // La session doit être posée (cookies lus par le middleware) avant de quitter la page.
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ErreurServeurPasskey("Clé reconnue, mais la session ne s'est pas enregistrée dans le navigateur (cookies bloqués ?).", "session_absente", 200);
  return { attempted: true };
}
