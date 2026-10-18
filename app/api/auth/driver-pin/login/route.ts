import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifierPin } from "@/lib/auth/pin-securise";

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  pin: z.string().regex(/^\\d{4,32}$/),
});

/**
 * Connexion chauffeur par e-mail + PIN, sans QR code.
 * Permet aux comptes chauffeur historiques de se connecter et convertit
 * leur ancien mot de passe PIN vers le format dérivé sécurisé à la première
 * connexion réussie. Les limites de tentatives sont communes au parcours QR.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Saisissez un e-mail valide et votre PIN." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const email = parsed.data.email.toLowerCase();
  const { data: user, error } = await admin
    .from("users")
    .select("id, email, organization_id, full_name, auth_method, pin_set_at, active, pending_approval")
    .eq("email", email)
    .maybeSingle();

  // Message volontairement générique pour ne pas révéler si l'adresse existe.
  if (error || !user || user.auth_method !== "pin" || !user.pin_set_at) {
    return NextResponse.json({ error: "Identifiants incorrects. Vérifiez votre e-mail et votre PIN ou contactez la direction." }, { status: 401 });
  }
  if (!user.active || user.pending_approval) {
    return NextResponse.json({ error: "Ce compte n'est pas actif. Contactez un responsable." }, { status: 403 });
  }

  const session = await createServerSupabaseClient();
  const result = await verifierPin(user, parsed.data.pin, session);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
