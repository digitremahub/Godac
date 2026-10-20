import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { webauthnConfig, WEBAUTHN_CHALLENGE_COOKIE } from "@/lib/auth/webauthn";

const bodySchema = z.object({
  response: z.custom<RegistrationResponseJSON>((v) => typeof v === "object" && v !== null),
  device_name: z.string().trim().max(60).nullable().optional(),
});

/** Step 2 — see ../options for the challenge cookie this reads back. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(WEBAUTHN_CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ error: "Session d'inscription expirée, recommencez." }, { status: 400 });
  }

  const { rpIdsAdmis, originesAdmises } = webauthnConfig(req.headers.get("origin"));
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.data.response,
      expectedChallenge,
      expectedOrigin: originesAdmises,
      expectedRPID: rpIdsAdmis,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Vérification échouée" }, { status: 400 });
  }
  cookieStore.delete(WEBAUTHN_CHALLENGE_COOKIE);

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Vérification échouée" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("webauthn_credentials").insert({
    user_id: appUser.id,
    credential_id: credential.id,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? null,
    device_name: parsed.data.device_name ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
