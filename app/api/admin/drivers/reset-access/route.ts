import { garderApi } from "@/lib/acces/garde-api";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { journaliser } from "@/lib/audit/journal";
import { creerCodeActivation, revoquerSessions } from "@/lib/auth/code-activation-serveur";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";

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
 * Réinitialise les moyens d'authentification des chauffeurs (et chefs
 * d'équipe chauffeurs) de l'organisation courante : mot de passe
 * aléatoire, sessions révoquées, clés biométriques supprimées et, pour un
 * compte badge + PIN, PIN effacé et code d'activation à remettre au
 * chauffeur (exigé pour choisir le nouveau PIN). Opération journalisée. Les opérations Supabase Auth et Postgres ne partagent pas de
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

  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut réinitialiser les accès chauffeurs." }, { status: 403 });
  }
  if (!appUser.organization_id) {
    return NextResponse.json({ error: "Organisation introuvable pour ce compte." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  // Chauffeurs et managers qui conduisent aussi (users.can_drive).
  const { data: drivers, error: lookupError } = await admin
    .from("users")
    .select("id, full_name, auth_method")
    .eq("organization_id", appUser.organization_id)
    .or(FILTRE_CONDUCTEURS);

  if (lookupError) {
    return NextResponse.json({ error: "Impossible de récupérer les chauffeurs de l'organisation." }, { status: 500 });
  }

  const comptes = drivers ?? [];
  if (comptes.length === 0) return NextResponse.json({ ok: true, resetCount: 0, failedCount: 0, failures: [], activationCodes: [] });

  const succeeded: string[] = [];
  const failures: { driverId: string; step: string; error: string }[] = [];
  // Codes d'activation en clair, affichés une seule fois à la direction :
  // sans eux, le badge seul ne permet plus de choisir un nouveau PIN.
  const activationCodes: { driverId: string; fullName: string; code: string }[] = [];

  for (const driver of comptes) {
    const id = driver.id;
    const { error: passwordError } = await admin.auth.admin.updateUserById(id, {
      password: randomBytes(48).toString("base64url"),
    });
    if (passwordError) {
      failures.push({ driverId: id, step: "password", error: passwordError.message });
      continue;
    }

    try {
      await revoquerSessions(admin, id);
    } catch (e) {
      failures.push({ driverId: id, step: "sessions", error: e instanceof Error ? e.message : String(e) });
      continue;
    }

    // auth_method n'est plus forcé : un compte e-mail reste un compte e-mail
    // (nouveau mot de passe aléatoire, sessions et clés biométriques révoquées).
    if (driver.auth_method === "pin") {
      let code: string;
      try {
        code = await creerCodeActivation(admin, { userId: id, organizationId: appUser.organization_id, createdBy: appUser.id });
      } catch (e) {
        failures.push({ driverId: id, step: "activation", error: e instanceof Error ? e.message : String(e) });
        continue;
      }
      const { error: profileError } = await admin
        .from("users")
        .update({ pin_set_at: null, driver_recovery_code_hash: null })
        .eq("id", id)
        .eq("organization_id", appUser.organization_id);
      if (profileError) {
        failures.push({ driverId: id, step: "profile", error: profileError.message });
        continue;
      }
      activationCodes.push({ driverId: id, fullName: driver.full_name, code });
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

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "acces_chauffeurs_reinitialises",
    targetTable: "users",
    details: { reinitialises: succeeded.length, echecs: failures.length, codes_activation: activationCodes.length },
  });

  if (failures.length > 0) {
    return NextResponse.json({
      ok: false,
      message: "Réinitialisation partielle. Consultez les étapes en échec avant de relancer l'opération.",
      resetCount: succeeded.length,
      failedCount: failures.length,
      failures,
      activationCodes,
    }, { status: 207 });
  }

  return NextResponse.json({ ok: true, resetCount: succeeded.length, failedCount: 0, failures: [], activationCodes });
}
