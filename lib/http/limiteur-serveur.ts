import "server-only";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { empreinteIp, ipDepuisEntetes, LimiteurMemoire, type DecisionLimite, type RegleLimite } from "@/lib/http/limite-debit";

const memoire = new LimiteurMemoire();

/**
 * Compte un passage sur une clé et dit s'il est permis. Table rate_limits
 * (atomique, partagée entre instances) ; fonction ou table absente (migration
 * non appliquée) ou base injoignable : repli en mémoire de l'instance, sans
 * jamais bloquer la route à cause du limiteur lui-même.
 */
export async function consommerLimite(cle: string, regle: RegleLimite): Promise<DecisionLimite> {
  try {
    const { data, error } = await createAdminSupabaseClient().rpc("consommer_limite", { p_cle: cle, p_max: regle.max, p_fenetre_s: regle.fenetreS });
    const ligne = (Array.isArray(data) ? data[0] : data) as { autorise: boolean; retry_apres_s: number } | null;
    if (!error && ligne && typeof ligne.autorise === "boolean") return { autorise: ligne.autorise, retryApresS: Number(ligne.retry_apres_s ?? 0) };
    if (error) console.warn("limiteur: repli en mémoire", error.code ?? error.message);
  } catch (e) {
    console.warn("limiteur: repli en mémoire", e instanceof Error ? e.message : e);
  }
  return memoire.consommer(cle, regle);
}

/** 429 + Retry-After. */
export function reponseTropDeRequetes(retryApresS: number, message = "Trop de requêtes. Réessayez dans un instant."): NextResponse {
  return NextResponse.json({ error: message }, { status: 429, headers: { "Retry-After": String(retryApresS) } });
}

/**
 * Limite une route publique par adresse IP.
 *
 *   const limite = await limiterParIp(req, REGLES_LIMITE.demandeDemo); if (limite) return limite;
 */
export async function limiterParIp(req: Request, regle: RegleLimite): Promise<NextResponse | null> {
  const decision = await consommerLimite(`${regle.nom}:${empreinteIp(ipDepuisEntetes(req.headers))}`, regle);
  return decision.autorise ? null : reponseTropDeRequetes(decision.retryApresS);
}
