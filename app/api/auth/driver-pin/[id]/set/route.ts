import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validatePin } from "@/lib/business/driver-pin";
import { motDePassePin } from "@/lib/auth/pin-securise";
import { createRecoveryCode, hashRecoveryCode } from "@/lib/auth/driver-recovery";
import { evaluerActivation, MESSAGES_ACTIVATION } from "@/lib/auth/code-activation";
import { codeActivationCorrespond } from "@/lib/auth/code-activation-serveur";

const bodySchema = z.object({ pin: z.string(), confirmPin: z.string(), activationCode: z.string().max(40).optional() });

/**
 * Création du PIN depuis le badge (route publique). Après une
 * réinitialisation par l'encadrement, le code d'activation remis au
 * chauffeur est exigé (driver_pin_activations) : connaître l'identifiant
 * du badge ne suffit plus à prendre le compte.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  if (parsed.data.pin !== parsed.data.confirmPin) return NextResponse.json({ error: "Les deux codes PIN ne correspondent pas." }, { status: 400 });
  const pinCheck = validatePin(parsed.data.pin);
  if (!pinCheck.ok) return NextResponse.json({ error: pinCheck.message }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const { data: user, error: lookupError } = await admin.from("users").select("id, auth_method, pin_set_at, active").eq("id", id).maybeSingle();
  if (lookupError || !user || user.auth_method !== "pin") return NextResponse.json({ error: "Badge introuvable." }, { status: 404 });
  if (!user.active) return NextResponse.json({ error: "Ce compte est désactivé. Contactez un responsable." }, { status: 403 });
  if (user.pin_set_at) return NextResponse.json({ error: "Un code PIN existe déjà pour ce badge. Utilisez-le pour vous connecter." }, { status: 409 });

  const { data: activation, error: activationError } = await admin
    .from("driver_pin_activations")
    .select("code_hash, expires_at, failed_count")
    .eq("user_id", id)
    .maybeSingle();
  // Table absente (migration 20261019000005 pas encore appliquée) : aucune
  // réinitialisation n'a pu créer de code, on garde le parcours historique.
  const tableAbsente = activationError && ["42P01", "PGRST205"].includes(activationError.code ?? "");
  if (activationError && !tableAbsente) return NextResponse.json({ error: "Vérification impossible, réessayez." }, { status: 500 });
  const etat = evaluerActivation(activation, parsed.data.activationCode, (code) => codeActivationCorrespond(id, code, activation!.code_hash));
  if (!etat.ok) {
    if (etat.raison === "incorrect") {
      await admin.from("driver_pin_activations").update({ failed_count: (activation?.failed_count ?? 0) + 1 }).eq("user_id", id);
    }
    return NextResponse.json({ error: MESSAGES_ACTIVATION[etat.raison], activationRequired: true }, { status: etat.raison === "absent" ? 428 : 403 });
  }

  const recoveryCode = createRecoveryCode();
  const { error: passwordError } = await admin.auth.admin.updateUserById(id, { password: motDePassePin(id, parsed.data.pin) });
  if (passwordError) return NextResponse.json({ error: "Impossible de créer le PIN." }, { status: 500 });
  const { error: updateError } = await admin.from("users").update({ pin_set_at: new Date().toISOString(), driver_recovery_code_hash: hashRecoveryCode(id, recoveryCode) }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "Impossible d'enregistrer le code de récupération." }, { status: 500 });
  // Code d'activation à usage unique.
  if (activation) await admin.from("driver_pin_activations").delete().eq("user_id", id);
  return NextResponse.json({ ok: true, recoveryCode });
}
