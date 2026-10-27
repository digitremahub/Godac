import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { CORPS_ERREUR_MAX, assainirRapport } from "@/lib/observabilite/erreurs-client";
import { limiterParIp } from "@/lib/http/limiteur-serveur";
import { REGLES_LIMITE } from "@/lib/http/limite-debit";

/**
 * Réception des erreurs d'affichage (app/error.tsx, app/livreur/error.tsx,
 * global-error.tsx). Publique (l'erreur peut survenir avant la connexion),
 * donc limitée par adresse IP ; le rapport est assaini (aucun e-mail,
 * identifiant ni paramètre d'URL) et le stockage est borné (2000 lignes,
 * fonction SQL enregistrer_erreur_client). Table absente : simple ligne de
 * journal serveur. Répond toujours 204 : le navigateur n'a rien à en faire.
 */
export async function POST(req: Request) {
  const limite = await limiterParIp(req, REGLES_LIMITE.erreursClient);
  if (limite) return limite;
  const texte = await req.text().catch(() => "");
  if (!texte || texte.length > CORPS_ERREUR_MAX) return new NextResponse(null, { status: 204 });
  let brut: unknown = null;
  try {
    brut = JSON.parse(texte);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const rapport = assainirRapport(brut);
  if (!rapport) return new NextResponse(null, { status: 204 });

  console.error(`client-error ${rapport.origine} ${rapport.chemin} : ${rapport.message}${rapport.digest ? ` (digest ${rapport.digest})` : ""}`);
  try {
    const { error } = await createAdminSupabaseClient().rpc("enregistrer_erreur_client", {
      p_origine: rapport.origine,
      p_message: rapport.message,
      p_digest: rapport.digest,
      p_chemin: rapport.chemin,
    });
    if (error && error.code !== "PGRST202" && error.code !== "42883") console.warn("client-errors: non enregistré", error.code ?? error.message);
  } catch (e) {
    console.warn("client-errors: non enregistré", e instanceof Error ? e.message : e);
  }
  return new NextResponse(null, { status: 204 });
}
