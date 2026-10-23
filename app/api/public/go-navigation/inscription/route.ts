import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { journaliser } from "@/lib/audit/journal";
import { ACCORD_USAGE_VERSION, ACCUEIL_GO_NAVIGATION, formulaireInscriptionSchema } from "@/lib/go-navigation/offre";
import { inscrireGoNavigation, limiteAtteinte, noterAcces } from "@/lib/go-navigation/serveur";

/**
 * Inscription GO Navigation (page publique /go-navigation/[jeton]), sans
 * session : limitation de débit par IP hachée, validation du formulaire,
 * puis création du compte d'essai (lib/go-navigation/serveur.ts) et
 * connexion immédiate (cookies de session posés par le client serveur).
 */
export async function POST(req: Request) {
  const admin = createAdminSupabaseClient();
  const limite = await limiteAtteinte(admin, req.headers, true);
  if (limite.message) return NextResponse.json({ error: limite.message }, { status: 429 });
  await noterAcces(admin, limite.ipHash, "tentative");

  const parsed = formulaireInscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const premier = parsed.error.issues[0]?.message;
    return NextResponse.json({ error: premier && premier !== "Required" ? premier : "Formulaire incomplet." }, { status: 400 });
  }

  const r = await inscrireGoNavigation(admin, parsed.data);
  if (!r.ok) {
    if (r.echecJeton) await noterAcces(admin, limite.ipHash, "echec");
    return NextResponse.json({ error: r.message }, { status: r.statut });
  }

  await journaliser({
    organizationId: r.organizationId,
    userId: r.userId,
    action: "inscription_go_navigation",
    targetTable: "organizations",
    targetId: r.organizationId,
    details: { offre: "go_navigation", apporteur_user_id: r.apporteurUserId, lien_id: r.lienId },
  });
  if (r.accordUsage) {
    await journaliser({
      organizationId: r.organizationId,
      userId: r.userId,
      action: "accord_usage_essai",
      targetTable: "organizations",
      targetId: r.organizationId,
      details: { accord: true, version: ACCORD_USAGE_VERSION, via: "inscription" },
    });
  }
  // Trace aussi chez l'apporteur (journal de son organisation) : qui a fait essayer GO.
  if (r.apporteurUserId && r.apporteurOrgId) {
    await journaliser({
      organizationId: r.apporteurOrgId,
      userId: r.apporteurUserId,
      action: "inscription_go_navigation",
      targetTable: "organizations",
      targetId: r.organizationId,
      details: { offre: "go_navigation", via: r.lienId ? "lien_personnel" : "invitation" },
    });
  }

  // Connexion directe : le compte vient d'être créé avec ce mot de passe.
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.motDePasse });
  return NextResponse.json({ redirection: error ? `/sign-in?redirect_to=${encodeURIComponent(ACCUEIL_GO_NAVIGATION)}` : ACCUEIL_GO_NAVIGATION });
}
