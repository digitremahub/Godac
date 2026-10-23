import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { OFFRE_GO_NAVIGATION, preuveAccordUsage } from "@/lib/go-navigation/offre";

export const MESSAGE_MIGRATION_ACCORD_USAGE = "Le réglage n'est pas encore disponible. Réessayez plus tard.";

export type ResultatAccordUsage = { ok: true } | { ok: false; migrationManquante: boolean };

/**
 * Enregistre (ou retire) l'accord de partage du détail d'usage d'un compte
 * d'essai. Date et texte sont posés côté serveur, jamais par le client :
 * le texte (avec sa version) n'est écrit que lors d'un accord ; au retrait
 * on garde le dernier texte accepté et on met à jour la date du changement
 * (l'historique complet est dans le journal d'audit). Réservé aux
 * organisations d'offre GO Navigation. Colonnes absentes (migration
 * 20261103000004 pas appliquée) : renvoie migrationManquante, sans lever.
 */
export async function enregistrerAccordUsage(admin: SupabaseClient, organizationId: string, accepte: boolean, maintenant: Date = new Date()): Promise<ResultatAccordUsage> {
  const champs: Record<string, unknown> = { partage_usage_detail: accepte, partage_usage_detail_at: maintenant.toISOString() };
  if (accepte) champs.partage_usage_detail_texte = preuveAccordUsage();
  const { data, error } = await admin.from("organizations").update(champs).eq("id", organizationId).eq("offre", OFFRE_GO_NAVIGATION).select("id").maybeSingle();
  if (error) {
    const manquante = estSchemaManquant(error);
    if (!manquante) console.error("accord d'usage: enregistrement impossible", error.message);
    return { ok: false, migrationManquante: manquante };
  }
  return data ? { ok: true } : { ok: false, migrationManquante: false };
}

export interface EtatAccordUsage {
  /** Colonnes présentes (migration appliquée). */
  disponible: boolean;
  accepte: boolean;
  /** Date du dernier changement (accord donné ou retiré). */
  le: string | null;
}

/** Accord en vigueur d'une organisation ; colonnes absentes = indisponible, jamais accepté. */
export async function lireAccordUsage(client: SupabaseClient, organizationId: string): Promise<EtatAccordUsage> {
  try {
    const { data, error } = await client.from("organizations").select("partage_usage_detail, partage_usage_detail_at").eq("id", organizationId).maybeSingle();
    if (error || !data) return { disponible: false, accepte: false, le: null };
    const o = data as { partage_usage_detail?: boolean | null; partage_usage_detail_at?: string | null };
    return { disponible: true, accepte: o.partage_usage_detail === true, le: o.partage_usage_detail_at ?? null };
  } catch (e) {
    console.error("accord d'usage: lecture impossible", e);
    return { disponible: false, accepte: false, le: null };
  }
}
