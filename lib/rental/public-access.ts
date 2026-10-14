import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashIp, hashProviderToken, isTokenUsable, looksLikeProviderToken, RATE_LIMITS } from "@/lib/rental/token";

export interface ProviderRequestRow {
  id: string;
  organization_id: string;
  vehicle_id: string;
  intervention_id: string;
  provider_id: string | null;
  status: string;
  token_expires_at: string | null;
}

export type ProviderAccess = { ok: true; request: ProviderRequestRow; ipHash: string } | { ok: false; httpStatus: number; message: string };

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "inconnue";
}

async function countSince(admin: SupabaseClient, ipHash: string, kind: string, ms: number): Promise<number> {
  const { count } = await admin
    .from("rental_provider_access_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("kind", kind)
    .gte("created_at", new Date(Date.now() - ms).toISOString());
  return count ?? 0;
}

/**
 * Contrôle d'accès du lien prestataire (page et API) : limitation de
 * débit par IP hachée, forme du jeton, correspondance du hash, expiration
 * et module toujours actif. Ne renvoie que la demande liée au jeton —
 * jamais d'autre donnée de l'organisation. Client service-role : appelé
 * uniquement depuis le serveur, après ces contrôles.
 */
export async function resolveProviderAccess(admin: SupabaseClient, token: string, headers: Headers, kind: "lecture" | "action"): Promise<ProviderAccess> {
  const ipHash = hashIp(clientIp(headers));

  if ((await countSince(admin, ipHash, "echec", 15 * 60_000)) >= RATE_LIMITS.echecs15min) {
    return { ok: false, httpStatus: 429, message: "Trop de tentatives. Réessayez dans quelques minutes." };
  }
  const limit = kind === "action" ? RATE_LIMITS.actionsHeure : RATE_LIMITS.lecturesHeure;
  if ((await countSince(admin, ipHash, kind, 3_600_000)) >= limit) {
    return { ok: false, httpStatus: 429, message: "Trop de requêtes. Réessayez plus tard." };
  }

  const fail = async (httpStatus: number, message: string): Promise<ProviderAccess> => {
    await admin.from("rental_provider_access_log").insert({ ip_hash: ipHash, kind: "echec" });
    return { ok: false, httpStatus, message };
  };

  if (!looksLikeProviderToken(token)) return fail(404, "Lien invalide.");

  const { data } = await admin
    .from("rental_maintenance_requests")
    .select("id, organization_id, vehicle_id, intervention_id, provider_id, status, token_expires_at")
    .eq("token_hash", hashProviderToken(token))
    .maybeSingle();
  if (!data) return fail(404, "Lien invalide ou remplacé par un lien plus récent.");
  if (!isTokenUsable(data.token_expires_at)) return fail(410, "Ce lien a expiré. Demandez un nouveau lien à l'entreprise.");

  const { data: mod } = await admin
    .from("organization_modules")
    .select("enabled")
    .eq("organization_id", data.organization_id)
    .eq("module_key", "rental_providers")
    .maybeSingle();
  if (!mod?.enabled) return fail(404, "Lien invalide.");

  await admin.from("rental_provider_access_log").insert({ ip_hash: ipHash, kind, request_id: data.id });
  return { ok: true, request: data as ProviderRequestRow, ipHash };
}
