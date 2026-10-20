import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { regenererJetonInscription } from "@/lib/organization/lien-inscription";

/**
 * Rotates the org's self-signup link (app/join/[token]) — the only
 * real mitigation if it's shared somewhere it shouldn't be, since
 * anyone holding the old link can no longer create pending accounts
 * with it once this runs. Audit M18 : le jeton vit dans
 * organization_signup_tokens, sans policy d'écriture : écrit ici avec le
 * client service, après le contrôle « direction » ci-dessous.
 */
export async function POST() {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut régénérer ce lien." }, { status: 403 });
  }

  try {
    const token = await regenererJetonInscription(createAdminSupabaseClient(), appUser.organization_id);
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
