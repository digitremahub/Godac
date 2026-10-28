import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isModuleEnabled } from "@/lib/organization/modules";
import { memoriserModule, moduleDejaVerifie } from "@/lib/organization/modules-verifies";
import { estFormatEtiquette, type CleFormatEtiquette } from "@/lib/stock/formats-etiquette";
import { CONFIG_VIDE, lireProfilsConfig, normaliserProfils, type CleProfil, type ProfilsConfig } from "@/lib/stock/profils";
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
  /** Profils activés (clés du catalogue : messagerie, palettes, sante, pharmacie, alimentaire, vrac, personnalise). */
  profils: CleProfil[];
  /** Ajustements des profils par l'entreprise (vocabulaire, champs, alertes, étiquette). */
  config: ProfilsConfig;
  /** Préfixe des codes internes enregistré (null : le défaut dérivé du nom sera enregistré à la première génération). */
  prefixe: string | null;
  /** Format d'étiquette choisi pour l'organisation. */
  formatEtiquette: CleFormatEtiquette | null;
  /** Les tables et fonctions des codes, attributs et profils adaptables sont installées (migrations 20261115). */
  codesInstalles: boolean;
  /** Les tables du stock n'existent pas encore (migrations non appliquées). */
  schemaAbsent: boolean;
}

const VIDE: ParametresStock = { profils: [], config: CONFIG_VIDE, prefixe: null, formatEtiquette: null, codesInstalles: false, schemaAbsent: false };

const colonneAbsente = (e: { code?: string | null; message?: string | null }) => e.code === "42703" || /column .* does not exist|Could not find the '.*' column/i.test(e.message ?? "");

/**
 * Profils activés et leur personnalisation. Tolérant : table absente = aucun profil et
 * schemaAbsent ; migrations des codes pas encore appliquées = profils historiques seulement.
 */
export async function lireParametresStock(supabase: SupabaseClient, organizationId: string): Promise<ParametresStock> {
  const complet = await supabase.from("stock_parametres").select("profils, prefixe_code, format_etiquette, profils_config").eq("organization_id", organizationId).maybeSingle();
  if (!complet.error) {
    const d = complet.data as { profils?: unknown; prefixe_code?: string | null; format_etiquette?: string | null; profils_config?: unknown } | null;
    const config = lireProfilsConfig(d?.profils_config);
    // Les profils actifs viennent de la configuration ; à défaut, de la colonne historique.
    const profils = config.actifs.length ? config.actifs : normaliserProfils(d?.profils);
    return { profils, config: { ...config, actifs: profils }, prefixe: d?.prefixe_code ?? null, formatEtiquette: estFormatEtiquette(d?.format_etiquette) ? d.format_etiquette : null, codesInstalles: true, schemaAbsent: false };
  }
  if (colonneAbsente(complet.error)) {
    const ancien = await supabase.from("stock_parametres").select("profils").eq("organization_id", organizationId).maybeSingle();
    if (ancien.error) {
      if (schemaStockAbsent(ancien.error)) return { ...VIDE, schemaAbsent: true };
      console.error("stock_parametres", ancien.error.message);
      return VIDE;
    }
    const profils = normaliserProfils((ancien.data as { profils?: unknown } | null)?.profils);
    return { ...VIDE, profils, config: { ...CONFIG_VIDE, actifs: profils } };
  }
  if (schemaStockAbsent(complet.error)) return { ...VIDE, schemaAbsent: true };
  console.error("stock_parametres", complet.error.message);
  return VIDE;
}

export type ResultatMouvement =
  | { ok: true; doublon: boolean; mouvementId: string | null; uniteId: string | null; statut: string | null; quantiteApres: number | null; code: string | null; codeInterne: string | null }
  | ({ ok: false } & ErreurStock);

/**
 * Appelle la fonction SQL de mouvement (transaction unique : registre, solde ou
 * unité). Une clé déjà connue renvoie le mouvement existant (doublon). Deux
 * requêtes simultanées de même clé : la seconde échoue sur l'unicité, ce qui
 * est traité comme un doublon.
 */
export async function appelerMouvement(supabase: SupabaseClient, params: ParametresRpcMouvement): Promise<ResultatMouvement> {
  // Les appels de l'application passent par la fonction v2 (code interne, profil, attributs) ; les liens avec
  // les tournées (sans ces champs) gardent la fonction d'origine.
  const v2 = params.p_profil !== undefined || params.p_code_interne !== undefined || params.p_attributs !== undefined;
  let { data, error } = await supabase.rpc(v2 ? "stock_enregistrer_mouvement_v2" : "stock_enregistrer_mouvement", params as unknown as Record<string, unknown>);
  if (error && v2 && schemaStockAbsent(error) && !params.p_code_interne && !params.p_attributs && !params.p_profil) {
    // Migrations des codes pas encore appliquées : le mouvement simple reste possible.
    const { p_profil: _p, p_code_interne: _c, p_attributs: _a, ...ancien } = params;
    void _p; void _c; void _a;
    ({ data, error } = await supabase.rpc("stock_enregistrer_mouvement", ancien as unknown as Record<string, unknown>));
  }
  if (error) {
    if (error.code === "23505" && /cle_idempotence|stock_mouvements/.test(error.message ?? "")) {
      return { ok: true, doublon: true, mouvementId: null, uniteId: null, statut: null, quantiteApres: null, code: null, codeInterne: null };
    }
    return { ok: false, ...traduireErreurStock(error) };
  }
  const r = (data ?? {}) as { doublon?: boolean; mouvement_id?: string; unite_id?: string; statut?: string; quantite_apres?: number | string; code?: string; code_interne?: string | null };
  return {
    ok: true,
    doublon: Boolean(r.doublon),
    mouvementId: r.mouvement_id ?? null,
    uniteId: r.unite_id ?? null,
    statut: r.statut ?? null,
    quantiteApres: r.quantite_apres === undefined ? null : Number(r.quantite_apres),
    code: r.code ?? null,
    codeInterne: r.code_interne ?? null,
  };
}
