import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { webauthnConfig, WEBAUTHN_CHALLENGE_COOKIE } from "@/lib/auth/webauthn";

const bodySchema = z.object({
  response: z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null),
});

/**
 * Public (pre-session) — step 2. Who this logs in as is decided by
 * looking up `response.id` in webauthn_credentials ourselves, never
 * trusted from the client, so a credential can only ever authenticate
 * as the user it was registered to (see ../options, called first).
 * On success, mints a one-time Supabase magic-link token server-side
 * (admin.generateLink) and hands it back for the client to redeem via
 * supabase.auth.verifyOtp — the same trick used to bridge any custom
 * auth check into a real Supabase session without ever touching the
 * account's actual password/PIN.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const response = parsed.data.response;

  const admin = createAdminSupabaseClient();
  const { data: stored } = await admin
    .from("webauthn_credentials")
    .select("id, user_id, credential_id, public_key, counter, transports")
    .eq("credential_id", response.id)
    .maybeSingle();
  if (!stored) {
    return NextResponse.json({ error: "Clé non reconnue sur cet appareil." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ error: "Session de connexion expirée, réessayez." }, { status: 400 });
  }

  const { rpID, origin } = webauthnConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.counter),
        transports: stored.transports ?? undefined,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Vérification échouée" }, { status: 400 });
  }
  cookieStore.delete(WEBAUTHN_CHALLENGE_COOKIE);

  if (!verification.verified) {
    return NextResponse.json({ error: "Vérification échouée" }, { status: 400 });
  }

  await admin
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq("id", stored.id);

  const { data: user, error: userError } = await admin
    .from("users")
    .select("email")
    .eq("id", stored.user_id)
    .single();
  if (userError || !user) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (linkError || !link) {
    return NextResponse.json({ error: linkError?.message ?? "Connexion impossible." }, { status: 500 });
  }

  return NextResponse.json({ email: user.email, token: link.properties.hashed_token });
}
