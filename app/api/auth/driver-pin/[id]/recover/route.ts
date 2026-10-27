import { NextResponse } from "next/server";
import { z } from "zod";
import { limiterParIp } from "@/lib/http/limiteur-serveur";
import { REGLES_LIMITE } from "@/lib/http/limite-debit";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validatePin } from "@/lib/business/driver-pin";
import { motDePassePin } from "@/lib/auth/pin-securise";
import { createRecoveryCode, hashRecoveryCode, recoveryCodeMatches } from "@/lib/auth/driver-recovery";
const schema = z.object({ recoveryCode: z.string().min(8).max(40), pin: z.string(), confirmPin: z.string() });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limite = await limiterParIp(req, REGLES_LIMITE.recuperationPin);
  if (limite) return limite;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Code de récupération ou PIN invalide." }, { status: 400 });
  if (parsed.data.pin !== parsed.data.confirmPin) return NextResponse.json({ error: "Les deux codes PIN ne correspondent pas." }, { status: 400 });
  const pinCheck = validatePin(parsed.data.pin);
  if (!pinCheck.ok) return NextResponse.json({ error: pinCheck.message }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const { data: user, error } = await admin.from("users").select("id, auth_method, active, pending_approval, driver_recovery_code_hash").eq("id", id).maybeSingle();
  if (error || !user || user.auth_method !== "pin") return NextResponse.json({ error: "Badge introuvable." }, { status: 404 });
  if (!user.active || user.pending_approval) return NextResponse.json({ error: "Ce compte n'est pas actif. Contactez un responsable." }, { status: 403 });
  if (!user.driver_recovery_code_hash || !recoveryCodeMatches(id, parsed.data.recoveryCode, user.driver_recovery_code_hash)) {
    return NextResponse.json({ error: "Code de récupération incorrect. Contactez un responsable si vous l'avez perdu." }, { status: 401 });
  }
  const nextRecoveryCode = createRecoveryCode();
  const { error: passwordError } = await admin.auth.admin.updateUserById(id, { password: motDePassePin(id, parsed.data.pin) });
  if (passwordError) return NextResponse.json({ error: "Impossible de réinitialiser le PIN." }, { status: 500 });
  const { error: updateError } = await admin.from("users").update({ driver_recovery_code_hash: hashRecoveryCode(id, nextRecoveryCode), pin_set_at: new Date().toISOString() }).eq("id", id);
  if (updateError) return NextResponse.json({ error: "PIN modifié mais renouvellement du code de secours impossible. Contactez un responsable." }, { status: 500 });
  return NextResponse.json({ ok: true, recoveryCode: nextRecoveryCode });
}