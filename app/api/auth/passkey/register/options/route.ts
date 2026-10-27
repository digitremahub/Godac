import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cookieChallengeSigne, optionsCookieChallenge, webauthnConfig, WEBAUTHN_CHALLENGE_COOKIE } from "@/lib/auth/webauthn";

/**
 * Step 1 of registering a passkey from /account (any role — see
 * components/account/PasskeyManager.tsx): excludes already-registered
 * credentials so the same authenticator can't be added twice, then
 * stashes the challenge in a short-lived httpOnly cookie for
 * ../verify to check against (stateless — no server-side session
 * store needed between the two requests of one registration).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", appUser.id);

  const { rpName, rpID, origin } = webauthnConfig(req.headers.get("origin"));
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: appUser.email,
    userDisplayName: appUser.full_name,
    userID: isoUint8Array.fromUTF8String(appUser.id),
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      // « preferred » : les clés Android (Gestionnaire de mots de passe
      // Google), iCloud et Windows Hello sont découvrables, ce qui permet la
      // connexion sans e-mail ; « required » refuserait les appareils plus anciens.
      residentKey: "preferred",
    },
    excludeCredentials: (existing ?? []).map((c) => ({
      id: c.credential_id,
      transports: c.transports ?? undefined,
    })),
  });

  const cookieStore = await cookies();
  cookieStore.set(WEBAUTHN_CHALLENGE_COOKIE, cookieChallengeSigne(options.challenge), optionsCookieChallenge(origin));

  return NextResponse.json(options);
}
