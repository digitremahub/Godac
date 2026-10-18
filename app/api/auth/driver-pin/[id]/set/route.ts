import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validatePin } from "@/lib/business/driver-pin";
import { motDePassePin } from "@/lib/auth/pin-securise";
import { createRecoveryCode, hashRecoveryCode } from "@/lib/auth/driver-recovery";
const bodySchema = z.object({ pin: z.string(), confirmPin: z.string() });
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
  const recoveryCode = createRecoveryCode();
  const { error: passwordError } = await admin.auth.admin.updateUserById(id, { password: motDePassePin(id, parsed.data.pin) });
  if (passwordError) return NextResponse.json({ error: "Impossible de créer le PIN." }, { status: 500 });
  const { error: updateError } = await admin.from("users").update({ pin_set_at: new Date().toISOString(), driver_recovery_code_hash: hashRecoveryCode(id, recoveryCode) }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "Impossible d'enregistrer le code de récupération." }, { status: 500 });
  return NextResponse.json({ ok: true, recoveryCode });
}