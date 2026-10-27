import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { limiterParIp } from "@/lib/http/limiteur-serveur";
import { REGLES_LIMITE } from "@/lib/http/limite-debit";
import { verifierPin } from "@/lib/auth/pin-securise";
import { choisirCompte, connexionEmailPinSchema, motifIlikeExact, type CompteCandidat } from "@/lib/auth/connexion-email-pin";

const MESSAGE_GENERIQUE = "Identifiants incorrects. Vérifiez votre e-mail et votre PIN ou contactez la direction.";

/**
 * Connexion chauffeur par e-mail + PIN, sans QR code.
 * L'e-mail saisi est l'e-mail de contact du chauffeur (`users.contact_email`)
 * ou, pour un compte historique, son e-mail de connexion. Il doit désigner
 * un seul compte PIN ; sinon le chauffeur passe par son badge.
 * Convertit l'ancien mot de passe PIN vers le format dérivé sécurisé à la
 * première connexion réussie. Les limites de tentatives sont communes au
 * parcours QR.
 */
export async function POST(req: Request) {
  const limite = await limiterParIp(req, REGLES_LIMITE.connexionPin);
  if (limite) return limite;
  const parsed = connexionEmailPinSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Saisissez un e-mail valide et votre PIN." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const email = parsed.data.email.toLowerCase();
  const motif = motifIlikeExact(email);
  const colonnes = "id, email, contact_email, organization_id, full_name, auth_method, pin_set_at, active, pending_approval";
  const [parEmail, parContact] = await Promise.all([
    admin.from("users").select(colonnes).ilike("email", motif).limit(5),
    admin.from("users").select(colonnes).ilike("contact_email", motif).limit(5),
  ]);
  if (parEmail.error || parContact.error) {
    console.error("driver-pin login lookup", parEmail.error ?? parContact.error);
    return NextResponse.json({ error: "Connexion momentanément indisponible, réessayez." }, { status: 500 });
  }

  const choix = choisirCompte([...(parEmail.data ?? []), ...(parContact.data ?? [])] as CompteCandidat[], email);
  if (!choix.ok && choix.raison === "ambigu") {
    return NextResponse.json(
      { error: "Plusieurs comptes utilisent cette adresse : connectez-vous avec votre badge (QR code) ou contactez la direction." },
      { status: 409 },
    );
  }
  // Message volontairement générique pour ne pas révéler si l'adresse existe.
  if (!choix.ok || !choix.compte.pin_set_at) {
    return NextResponse.json({ error: MESSAGE_GENERIQUE }, { status: 401 });
  }
  const user = choix.compte;
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
