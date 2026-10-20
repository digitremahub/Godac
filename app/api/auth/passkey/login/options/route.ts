import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { optionsCookieChallenge, webauthnConfig, WEBAUTHN_CHALLENGE_COOKIE } from "@/lib/auth/webauthn";
import type { RaisonPasskey } from "@/lib/auth/passkey-erreurs";

// Corps vide ({}) : connexion sans e-mail, par clé « découvrable ».
const bodySchema = z.object({
  user_id: z.string().uuid().optional(),
  email: z.string().trim().toLowerCase().email().optional(),
});

/** Échappe % et _ (jokers de ilike) : comparaison exacte, casse ignorée. */
function echapperMotif(valeur: string): string {
  return valeur.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Journal d'un échec : un code de raison, jamais d'e-mail complet, de secret ni de jeton. */
function journal(raison: RaisonPasskey, detail?: string) {
  console.warn(`passkey/login/options: ${raison}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Public (pre-session) — step 1 of "Se connecter avec Face ID /
 * empreinte". Three ways in:
 * - user_id (badge QR, /driver-pin/[id]);
 * - email typed in the office sign-in form (case-insensitive; every
 *   active account with that e-mail is considered);
 * - nothing: discoverable credential — allowCredentials is empty, the
 *   phone offers the keys it holds for this domain, and ../verify finds
 *   the account from the credential id. No e-mail to mistype.
 * Returns the same { available: false } whether the account doesn't
 * exist or just has no passkey — doesn't confirm account existence.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    journal("requete_invalide");
    return NextResponse.json({ error: "Adresse e-mail invalide.", code: "requete_invalide" }, { status: 400 });
  }
  const { rpID, origin } = webauthnConfig(req.headers.get("origin"));
  const decouvrable = !parsed.data.user_id && !parsed.data.email;

  let allowCredentials: { id: string; transports?: string[] }[] = [];
  if (!decouvrable) {
    const admin = createAdminSupabaseClient();
    let userIds: string[] = parsed.data.user_id ? [parsed.data.user_id] : [];
    if (!userIds.length && parsed.data.email) {
      const { data: users } = await admin
        .from("users")
        .select("id")
        // Casse ignorée : un téléphone met souvent une majuscule à l'e-mail saisi.
        .ilike("email", echapperMotif(parsed.data.email))
        .eq("active", true)
        .limit(5);
      userIds = (users ?? []).map((u) => u.id as string);
    }
    if (!userIds.length) {
      journal("sans_compte", parsed.data.email ? `domaine ${parsed.data.email.split("@")[1] ?? "?"}` : "user_id");
      return NextResponse.json({ available: false });
    }
    const { data: credentials, error } = await admin.from("webauthn_credentials").select("credential_id, transports").in("user_id", userIds);
    if (error) journal("sans_cle", `lecture : ${error.message}`);
    if (!credentials || credentials.length === 0) {
      journal("sans_cle", `${userIds.length} compte(s)`);
      return NextResponse.json({ available: false });
    }
    allowCredentials = credentials.map((c) => ({ id: c.credential_id as string, transports: (c.transports as string[] | null) ?? undefined }));
  }

  const options = await generateAuthenticationOptions({
    rpID,
    // Même exigence qu'à l'enregistrement : biométrie ou code de l'appareil.
    userVerification: "required",
    timeout: 120_000,
    allowCredentials: allowCredentials as Parameters<typeof generateAuthenticationOptions>[0]["allowCredentials"],
  });

  const cookieStore = await cookies();
  cookieStore.set(WEBAUTHN_CHALLENGE_COOKIE, options.challenge, optionsCookieChallenge(origin));

  return NextResponse.json({ available: true, decouvrable, options });
}
