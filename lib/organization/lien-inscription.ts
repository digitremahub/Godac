import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Jeton du lien d'inscription chauffeur (audit M18). Il vit dans
 * organization_signup_tokens (lecture : direction ; écriture : service
 * role), plus dans organizations.driver_signup_token, lisible par tous les
 * membres. Tant que la migration 20261021000001 n'est pas appliquée, les
 * fonctions retombent sur l'ancienne colonne. Toutes prennent le client
 * service (createAdminSupabaseClient).
 */

const tableAbsente = (code?: string) => code === "42P01" || code === "PGRST205";

/** Jeton en vigueur d'une organisation (créé à la volée s'il manque). */
export async function jetonInscription(admin: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data, error } = await admin.from("organization_signup_tokens").select("token").eq("organization_id", organizationId).maybeSingle();
  if (error && tableAbsente(error.code)) {
    const { data: org } = await admin.from("organizations").select("driver_signup_token").eq("id", organizationId).maybeSingle();
    return (org?.driver_signup_token as string | undefined) ?? null;
  }
  if (error) throw new Error(`Lien d'inscription illisible : ${error.message}`);
  if (data?.token) return data.token as string;
  const { data: cree, error: e2 } = await admin
    .from("organization_signup_tokens")
    .upsert({ organization_id: organizationId, token: randomUUID(), rotated_at: new Date().toISOString() }, { onConflict: "organization_id" })
    .select("token")
    .single();
  if (e2) throw new Error(`Lien d'inscription non créé : ${e2.message}`);
  return cree.token as string;
}

/** Organisation d'un jeton (page publique /join/[token], inscription). */
export async function organisationParJeton(admin: SupabaseClient, token: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await admin.from("organization_signup_tokens").select("organization_id").eq("token", token).maybeSingle();
  if (error && tableAbsente(error.code)) {
    const { data: org } = await admin.from("organizations").select("id").eq("driver_signup_token", token).maybeSingle();
    return (org?.id as string | undefined) ?? null;
  }
  if (error) return null;
  return (data?.organization_id as string | undefined) ?? null;
}

/** Nouveau jeton : l'ancien lien cesse de fonctionner. */
export async function regenererJetonInscription(admin: SupabaseClient, organizationId: string): Promise<string> {
  const token = randomUUID();
  const { error } = await admin
    .from("organization_signup_tokens")
    .upsert({ organization_id: organizationId, token, rotated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error && tableAbsente(error.code)) {
    const { error: e2 } = await admin.from("organizations").update({ driver_signup_token: token }).eq("id", organizationId);
    if (e2) throw new Error(e2.message);
    return token;
  }
  if (error) throw new Error(error.message);
  return token;
}
