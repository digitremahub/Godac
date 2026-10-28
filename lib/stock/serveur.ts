import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isModuleEnabled } from "@/lib/organization/modules";
import { memoriserModule, moduleDejaVerifie } from "@/lib/organization/modules-verifies";
import { normaliserProfils, type CleProfil } from "@/lib/stock/profils";
import { schemaStockAbsent, traduireErreurStock, type ErreurStock } from "@/lib/stock/erreurs";
import type { ParametresRpcMouvement } from "@/lib/stock/mouvements";

/** Module Stock actif pour cette organisation (réutilise le résultat que garderApi vient de calculer). */
export async function moduleStockActif(supabase: SupabaseClient, organizationId: string): Promise<boolean> {
  const dejaVerifie = moduleDejaVerifie(organizationId, "stock");
  if (dejaVerifie !== null) return dejaVerifie;
  const actif = await isModuleEnabled(supabase, organizationId, "stock");
  memoriserModule(organizationId, "stock", actif);
  return actif;
}

export interface ParametresStock {
  profils: CleProfil[];
  /** Les tables du stock n'existent pas encore (migrations non appliquées). */
  schemaAbsent: boolean;
}

/** Profils activés. Tolérant : table absente = aucun profil et schemaAbsent. */
export async function lireParametresStock(supabase: SupabaseClient, organizationId: string): Promise<ParametresStock> {
  const { data, error } = await supabase.from("stock_parametres").select("profils").eq("organization_id", organizationId).maybeSingle();
  if (error) {
    if (schemaStockAbsent(error)) return { profils: [], schemaAbsent: true };
    console.error("stock_parametres", error.message);
    return { profils: [], schemaAbsent: false };
  }
  return { profils: normaliserProfils((data as { profils?: unknown } | null)?.profils), schemaAbsent: false };
}

export type ResultatMouvement =
  | { ok: true; doublon: boolean; mouvementId: string | null; uniteId: string | null; statut: string | null; quantiteApres: number | null }
  | ({ ok: false } & ErreurStock);

/**
 * Appelle la fonction SQL de mouvement (transaction unique : registre, solde ou
 * unité). Une clé déjà connue renvoie le mouvement existant (doublon). Deux
 * requêtes simultanées de même clé : la seconde échoue sur l'unicité, ce qui
 * est traité comme un doublon.
 */
export async function appelerMouvement(supabase: SupabaseClient, params: ParametresRpcMouvement): Promise<ResultatMouvement> {
  const { data, error } = await supabase.rpc("stock_enregistrer_mouvement", params as unknown as Record<string, unknown>);
  if (error) {
    if (error.code === "23505" && /cle_idempotence|stock_mouvements/.test(error.message ?? "")) {
      return { ok: true, doublon: true, mouvementId: null, uniteId: null, statut: null, quantiteApres: null };
    }
    return { ok: false, ...traduireErreurStock(error) };
  }
  const r = (data ?? {}) as { doublon?: boolean; mouvement_id?: string; unite_id?: string; statut?: string; quantite_apres?: number | string };
  return {
    ok: true,
    doublon: Boolean(r.doublon),
    mouvementId: r.mouvement_id ?? null,
    uniteId: r.unite_id ?? null,
    statut: r.statut ?? null,
    quantiteApres: r.quantite_apres === undefined ? null : Number(r.quantite_apres),
  };
}
