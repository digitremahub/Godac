import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { webauthnConfig, WEBAUTHN_CHALLENGE_COOKIE } from "@/lib/auth/webauthn";
import { userIdDepuisHandle, type RaisonPasskey } from "@/lib/auth/passkey-erreurs";

const bodySchema = z.object({
  response: z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "string"),
});

/** Échec : code de raison au journal (jamais de jeton ni de secret) et réponse lisible. */
function echec(raison: RaisonPasskey, message: string, status: number, detail?: string) {
  console.warn(`passkey/login/verify: ${raison}${detail ? ` — ${detail}` : ""}`);
  return NextResponse.json({ error: message, code: raison }, { status });
}

/**
 * Public (pre-session) — step 2. Who this logs in as is decided by
 * looking up `response.id` in webauthn_credentials ourselves, never
 * trusted from the client, so a credential can only ever authenticate
 * as the user it was registered to — with or without an e-mail typed
 * in step 1 (discoverable credential). When the authenticator returns a
 * userHandle, it must match that user too.
 * On success, mints a one-time Supabase magic-link token server-side
 * (admin.generateLink) and hands it back for the client to redeem via
 * supabase.auth.verifyOtp({ token_hash }).
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return echec("requete_invalide", "Réponse biométrique illisible.", 400);
  const response = parsed.data.response;

  const admin = createAdminSupabaseClient();
  const { data: stored, error: lectureError } = await admin
    .from("webauthn_credentials")
    .select("id, user_id, credential_id, public_key, counter, transports")
    .eq("credential_id", response.id)
    .maybeSingle();
  if (!stored) {
    return echec(
      "cle_inconnue",
      "Cette clé Face ID / empreinte n'est pas (ou plus) enregistrée dans GODAC. Enregistrez-la de nouveau depuis Mon compte.",
      400,
      lectureError ? `lecture : ${lectureError.message}` : `id ${response.id.slice(0, 8)}…`,
    );
  }

  const handle = userIdDepuisHandle(response.response?.userHandle ?? null);
  if (handle && handle !== String(stored.user_id).toLowerCase()) {
    return echec("verification_echouee", "Cette clé n'appartient pas à ce compte.", 400, "userHandle différent du propriétaire de la clé");
  }

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return echec("challenge_absent", "Demande expirée ou cookie bloqué par le navigateur : réessayez (moins de 3 minutes entre l'ouverture et la validation).", 400);
  }

  const { originesAdmises, rpIdsAdmis } = webauthnConfig(req.headers.get("origin"));
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: originesAdmises,
      expectedRPID: rpIdsAdmis,
      requireUserVerification: true,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.counter),
        transports: stored.transports ?? undefined,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "inconnue";
    return echec("verification_echouee", `Vérification de la clé refusée : ${message}`, 400, message);
  }
  cookieStore.delete(WEBAUTHN_CHALLENGE_COOKIE);

  if (!verification.verified) {
    return echec("verification_echouee", "Vérification de la clé refusée.", 400, "verified=false");
  }

  await admin
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq("id", stored.id);

  const { data: user, error: userError } = await admin
    .from("users")
    .select("email, active")
    .eq("id", stored.user_id)
    .maybeSingle();
  if (userError || !user?.email) {
    return echec("lien_impossible", "Compte introuvable pour cette clé.", 404, userError?.message ?? "users.email vide");
  }
  if (user.active === false) {
    return echec("lien_impossible", "Ce compte est désactivé.", 403, "compte inactif");
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: String(user.email).trim().toLowerCase(),
  });
  if (linkError || !link?.properties?.hashed_token) {
    return echec("lien_impossible", `Clé reconnue, mais la session n'a pas pu être créée : ${linkError?.message ?? "lien vide"}.`, 500, linkError?.message ?? "hashed_token absent");
  }

  return NextResponse.json({ email: user.email, token: link.properties.hashed_token });
}
