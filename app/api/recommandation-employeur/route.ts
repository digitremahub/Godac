import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { cleEntreprise } from "@/lib/recommandation/entreprise";
import { MAX_RECOMMANDATIONS_PAR_JOUR, recommandationSchema } from "@/lib/recommandation/formulaire";
import { texteConsentementEnregistre } from "@/lib/recommandation/consentement";

const MIGRATION_MANQUANTE = "La recommandation n'est pas encore disponible. Réessayez plus tard ou écrivez-nous.";

/**
 * Un chauffeur connecté (quelle que soit son organisation) recommande
 * GODAC à son employeur. Aucune donnée n'est envoyée à l'employeur : seule
 * l'équipe GODAC voit la piste (/godac-staff/recommandations). Insertion
 * avec le client du chauffeur (RLS : referrer_user_id = lui-même).
 * Anti-abus : 5 recommandations par 24 h et jamais deux fois la même
 * entreprise par le même chauffeur.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;

  const parsed = recommandationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Formulaire invalide." }, { status: 400 });
  }
  const d = parsed.data;
  const companyKey = cleEntreprise(d.companyName);
  if (!companyKey) return NextResponse.json({ error: "Indiquez le nom de l'entreprise." }, { status: 400 });

  const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: errCompte } = await supabase
    .from("employer_referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_user_id", appUser.id)
    .gte("created_at", depuis);
  if (errCompte) {
    if (estSchemaManquant(errCompte)) return NextResponse.json({ error: MIGRATION_MANQUANTE }, { status: 503 });
    console.error("recommandation employeur (comptage)", errCompte.message);
    return NextResponse.json({ error: "Envoi impossible pour le moment. Réessayez dans un instant." }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_RECOMMANDATIONS_PAR_JOUR) {
    return NextResponse.json({ error: `Limite atteinte : ${MAX_RECOMMANDATIONS_PAR_JOUR} recommandations par jour. Réessayez demain.` }, { status: 429 });
  }

  const { data: doublon, error: errDoublon } = await supabase
    .from("employer_referrals")
    .select("id")
    .eq("referrer_user_id", appUser.id)
    .eq("company_key", companyKey)
    .limit(1);
  if (errDoublon) {
    console.error("recommandation employeur (doublon)", errDoublon.message);
    return NextResponse.json({ error: "Envoi impossible pour le moment. Réessayez dans un instant." }, { status: 500 });
  }
  if (doublon && doublon.length > 0) {
    return NextResponse.json({ error: "Vous avez déjà recommandé cette entreprise. Merci !" }, { status: 409 });
  }

  const { data: ligne, error } = await supabase
    .from("employer_referrals")
    .insert({
      referrer_user_id: appUser.id,
      referrer_org_id: appUser.organization_id,
      company_name: d.companyName,
      company_key: companyKey,
      contact_name: d.contactName,
      contact_email: d.contactEmail,
      contact_phone: d.contactPhone,
      message: d.message,
      consent: true,
      consent_text: texteConsentementEnregistre(),
    })
    .select("id")
    .single();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: MIGRATION_MANQUANTE }, { status: 503 });
    console.error("recommandation employeur", error.message);
    return NextResponse.json({ error: "Envoi impossible pour le moment. Réessayez dans un instant." }, { status: 500 });
  }

  // Journal : pas de coordonnées de l'employeur, seulement la clé de regroupement.
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "recommandation_employeur",
    targetTable: "employer_referrals",
    targetId: ligne?.id ?? null,
    details: { company_key: companyKey },
  });
  return NextResponse.json({ ok: true });
}
