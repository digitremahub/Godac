import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { webauthnConfig, WEBAUTHN_CHALLENGE_COOKIE } from "@/lib/auth/webauthn";

const bodySchema = z
  .object({ user_id: z.string().uuid().optional(), email: z.string().email().optional() })
  .refine((v) => v.user_id || v.email, { message: "user_id ou email requis" });

/**
 * Public (pre-session) — step 1 of "Se connecter avec Face ID /
 * empreinte", called from either /driver-pin/[id] (user_id already
 * known from the badge QR) or the office sign-in form (email typed
 * so far). Deliberately returns the same { available: false } shape
 * whether the account doesn't exist or just has no passkey — doesn't
 * confirm account existence either way.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  let userId = parsed.data.user_id ?? null;
  if (!userId && parsed.data.email) {
    const { data: user } = await admin
      .from("users")
      .select("id")
      .eq("email", parsed.data.email)
      .eq("active", true)
      .maybeSingle();
    userId = user?.id ?? null;
  }

  if (!userId) {
    return NextResponse.json({ available: false });
  }

  const { data: credentials } = await admin
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", userId);

  if (!credentials || credentials.length === 0) {
    return NextResponse.json({ available: false });
  }

  const { rpID } = webauthnConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: c.credential_id,
      transports: c.transports ?? undefined,
    })),
  });

  const cookieStore = await cookies();
  cookieStore.set(WEBAUTHN_CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 120,
    path: "/",
  });

  return NextResponse.json({ available: true, options });
}
