import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const CONFIRMATION_PHRASE = "REINITIALISER LES ACCES";

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * Réinitialise les moyens d'authentification des chauffeurs de l'organisation
 * courante. Les opérations Supabase Auth et Postgres ne partagent pas de
 * transaction : chaque chauffeur est donc traité séparément et les erreurs
 * partielles sont explicitement renvoyées.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origine de requête non autorisée." }, { status: 403 });
  }

  let body: { confirmation?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Confirmation manquante." }, { status: 400 });
  }
  if (body.confirmation !== CONFIRMATION_PHRASE) {
    return NextResponse.json({ error: "Saisissez la phrase de confirmation exacte pour continuer." }, { status: 400 });
  }

  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut réinitialiser les accès chauffeurs." }, { status: 403 });
  }
  if (!appUser.organization_id) {
    return NextResponse.json({ error: "Organisation introuvable pour ce compte." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: drivers, error: lookupError } = await admin
    .from("users")
    .select("id")
    .eq("organization_id", appUser.organization_id)
    .eq("role", "chauffeur");

  if (lookupError) {
    return NextResponse.json({ error: "Impossible de récupérer les chauffeurs de l'organisation." }, { status: 500 });
  }

  const ids = (drivers ?? []).map((driver) => driver.id);
  if (ids.length === 0) return NextResponse.json({ ok: true, resetCount: 0, failedCount: 0, failures: [] });

  const succeeded: string[] = [];
  const failures: { driverId: string; step: string; error: string }[] = [];

  for (const id of ids) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(id, {
      password: randomBytes(48).toString("base64url"),
    });
    if (passwordError) {
      failures.push({ driverId: id, step: "password", error: passwordError.message });
      continue;
    }

    const { error: profileError } = await admin
      .from("users")
      .update({ auth_method: "pin", pin_set_at: null, driver_recovery_code_hash: null })
      .eq("id", id)
      .eq("organization_id", appUser.organization_id)
      .eq("role", "chauffeur");

    if (profileError) {
      failures.push({ driverId: id, step: "profile", error: profileError.message });
      continue;
    }

    const { error: passkeyError } = await admin.from("webauthn_credentials").delete().eq("user_id", id);
    if (passkeyError) {
      failures.push({ driverId: id, step: "passkeys", error: passkeyError.message });
      continue;
    }

    const { error: attemptsError } = await admin.from("pin_login_attempts").delete().eq("user_id", id);
    if (attemptsError) {
      failures.push({ driverId: id, step: "pin_attempts", error: attemptsError.message });
      continue;
    }

    succeeded.push(id);
  }

  if (failures.length > 0) {
    return NextResponse.json({
      ok: false,
      message: "Réinitialisation partielle. Consultez les étapes en échec avant de relancer l'opération.",
      resetCount: succeeded.length,
      failedCount: failures.length,
      failures,
    }, { status: 207 });
  }

  return NextResponse.json({ ok: true, resetCount: succeeded.length, failedCount: 0, failures: [] });
}
