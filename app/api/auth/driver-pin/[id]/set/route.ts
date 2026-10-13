import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validatePin } from "@/lib/business/driver-pin";
import { motDePassePin } from "@/lib/auth/pin-securise";

const bodySchema = z.object({
  pin: z.string(),
  confirmPin: z.string(),
});

/**
 * Public by necessity: a driver scanning their badge for the first
 * time has no session yet (see middleware.ts's PUBLIC_PREFIXES and
 * app/driver-pin/[id]/page.tsx). Safe anyway — this only ever *sets* a
 * PIN once: a request for an account that already has `pin_set_at` is
 * rejected outright, closing the obvious "steal the badge, overwrite
 * the PIN" route. The id itself carries no more power than any other
 * GODAC QR badge already does (see lib/qr/scan-targets.ts).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (parsed.data.pin !== parsed.data.confirmPin) {
    return NextResponse.json({ error: "Les deux codes PIN ne correspondent pas." }, { status: 400 });
  }
  const pinCheck = validatePin(parsed.data.pin);
  if (!pinCheck.ok) {
    return NextResponse.json({ error: pinCheck.message }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: user, error: lookupError } = await admin
    .from("users")
    .select("id, auth_method, pin_set_at, active, email")
    .eq("id", id)
    .maybeSingle();

  if (lookupError || !user || user.auth_method !== "pin") {
    return NextResponse.json({ error: "Badge introuvable." }, { status: 404 });
  }
  if (!user.active) {
    return NextResponse.json({ error: "Ce compte est désactivé. Contactez un responsable." }, { status: 403 });
  }
  if (user.pin_set_at) {
    return NextResponse.json(
      { error: "Un code PIN existe déjà pour ce badge. Utilisez-le pour vous connecter." },
      { status: 409 },
    );
  }

  const { error: passwordError } = await admin.auth.admin.updateUserById(id, { password: motDePassePin(id, parsed.data.pin) });
  if (passwordError) {
    return NextResponse.json({ error: passwordError.message }, { status: 500 });
  }

  const { error: updateError } = await admin.from("users").update({ pin_set_at: new Date().toISOString() }).eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
