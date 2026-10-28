import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser } from "@/lib/audit/journal";
import { traduireErreurStock, type ErreurStock } from "@/lib/stock/erreurs";

export type ResultatGeneration =
  | { ok: true; doublon: boolean; codes: string[]; prefixe: string; annee: number }
  | { ok: false; erreur: ErreurStock };

/**
 * Appelle stock_generer_codes (compteur atomique, limite 500, idempotence par clé) et journalise
 * la génération (nombre, première et dernière valeur : jamais d'autre donnée). Un rejeu de la même
 * clé (doublon) n'est pas journalisé une seconde fois.
 */
export async function genererCodesInternes(
  supabase: SupabaseClient,
  appUser: { id: string; organization_id: string },
  nombre: number,
  cle: string,
  origine: "api" | "planche" | "entree",
): Promise<ResultatGeneration> {
  const { data, error } = await supabase.rpc("stock_generer_codes", { p_nombre: nombre, p_cle: cle });
  if (error) return { ok: false, erreur: traduireErreurStock(error) };
  const r = (data ?? {}) as { doublon?: boolean; codes?: string[]; prefixe?: string; annee?: number };
  const codes = Array.isArray(r.codes) ? r.codes : [];
  if (!r.doublon && codes.length > 0) {
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "stock_codes_generes",
      targetTable: "stock_generations",
      details: { nombre: codes.length, premier: codes[0], dernier: codes[codes.length - 1], origine },
    });
  }
  return { ok: true, doublon: Boolean(r.doublon), codes, prefixe: r.prefixe ?? "", annee: r.annee ?? 0 };
}
