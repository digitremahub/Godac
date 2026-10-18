import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Réinitialise les moyens d'authentification des chauffeurs de l'organisation
 * courante, sans supprimer les comptes ni les données métier/historiques.
 * Le nouvel enrôlement PIN et passkey doit être effectué après confirmation
 * par la Direction. Cette opération révoque toutes les passkeys des chauffeurs.
 */
export async function POST() {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut réinitialiser les accès chauffeurs." }, { status: 403 });
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
  if (ids.length === 0) return NextResponse.json({ ok: true, resetCount: 0 });

  // Invalider les clés biométriques avant de réinitialiser les identifiants.
  const { error: passkeyError } = await admin.from("webauthn_credentials").delete().in("user_id", ids);
  if (passkeyError) {
    return NextResponse.json({ error: "Impossible de révoquer les clés biométriques. Aucun compte n'a été réinitialisé." }, { status: 500 });
  }

  // Les mots de passe sont remplacés par des secrets aléatoires inconnus du chauffeur.
  // L'historique et les identifiants users.id ne changent pas.
  for (const id of ids) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(id, {
      password: randomBytes(48).toString("base64url"),
    });
    if (passwordError) {
      return NextResponse.json({
        error: "La révocation des passkeys est faite, mais certains mots de passe n'ont pas pu être réinitialisés. Relancez l'opération après vérification.",
        resetCount: 0,
      }, { status: 500 });
    }
  }

  const { error: profileError } = await admin
    .from("users")
    .update({
      auth_method: "pin",
      pin_set_at: null,
      driver_recovery_code_hash: null,
    })
    .eq("organization_id", appUser.organization_id)
    .eq("role", "chauffeur");

  if (profileError) {
    return NextResponse.json({ error: "Les secrets ont été révoqués, mais le profil n'a pas pu être réinitialisé. Contactez le support." }, { status: 500 });
  }

  await admin.from("pin_login_attempts").delete().in("user_id", ids);

  return NextResponse.json({ ok: true, resetCount: ids.length });
}
