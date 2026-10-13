import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { rechercherEntreprise } from "@/lib/organization/entreprise-serveur";

/**
 * Fiche d'une entreprise à partir de son SIRET/SIREN (répertoire
 * SIRENE via l'API publique recherche-entreprises). Ouverte à tout
 * utilisateur connecté, y compris pendant l'onboarding (pas encore
 * de profil GODAC) : ne lit que des données publiques et n'écrit rien.
 */
export async function GET(req: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const resultat = await rechercherEntreprise(q);
  if (!resultat.ok) return NextResponse.json({ error: resultat.erreur }, { status: resultat.status });
  return NextResponse.json({ entreprise: resultat.info });
}
