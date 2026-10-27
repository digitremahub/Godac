import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { limiterParIp } from "@/lib/http/limiteur-serveur";
import { REGLES_LIMITE } from "@/lib/http/limite-debit";
import { verifierPin } from "@/lib/auth/pin-securise";

const bodySchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

/**
 * Connexion par badge + code PIN, côté serveur : compteur d'essais,
 * verrou de 15 min et mot de passe dérivé (lib/auth/pin-securise.ts).
 * Publique par nécessité (aucune session avant la connexion).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limite = await limiterParIp(req, REGLES_LIMITE.connexionPin);
  if (limite) return limite;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Code PIN incorrect." }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: user } = await admin
    .from("users")
    .select("id, email, organization_id, full_name, auth_method, pin_set_at, active, pending_approval")
    .eq("id", id)
    .maybeSingle();
  if (!user || user.auth_method !== "pin" || !user.pin_set_at || !user.email) {
    return NextResponse.json({ error: "Badge introuvable." }, { status: 404 });
  }
  if (!user.active || user.pending_approval) {
    return NextResponse.json({ error: "Ce compte n'est pas actif. Contactez un responsable." }, { status: 403 });
  }

  const resultat = await verifierPin(user, parsed.data.pin, await createServerSupabaseClient());
  if (!resultat.ok) return NextResponse.json({ error: resultat.error }, { status: resultat.status });
  return NextResponse.json({ ok: true });
}
