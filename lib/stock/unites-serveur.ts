import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COLONNES_ATTRIBUTS, type AttributsLus } from "@/lib/stock/attributs";
import { nettoyerCode } from "@/lib/stock/codes";
import type { TypeUnite } from "@/lib/stock/profils";
import { PAR_PAGE_UNITES, clauseRecherche, type FiltresUnites } from "@/lib/stock/unites";

/** Lectures des unités partagées par les routes et les pages du stock (la RLS borne le périmètre de service). */

export interface UniteLue extends AttributsLus {
  id: string;
  activite: string;
  code: string;
  code_interne: string | null;
  profil: string | null;
  type_unite: TypeUnite;
  poids_kg: number | null;
  volume_m3: number | null;
  sscc: string | null;
  statut: string;
  site_id: string | null;
  emplacement_id: string | null;
  run_id: string | null;
  stop_id: string | null;
  created_at: string;
  updated_at: string;
}

const BASE = "id, activite, code, type_unite, poids_kg, volume_m3, sscc, statut, site_id, emplacement_id, run_id, stop_id, created_at, updated_at";
/** Colonnes de l'ancien schéma, tant que les migrations des codes ne sont pas appliquées. */
export const COLONNES_UNITE_ANCIEN = BASE;
export const COLONNES_UNITE = `${BASE}, code_interne, profil, ${COLONNES_ATTRIBUTS}`;

const colonneAbsente = (e: { code?: string | null; message?: string | null }) => e.code === "42703" || /column .* does not exist|Could not find the '.*' column/i.test(e.message ?? "");

/** Valeurs par défaut des champs absents (schéma ancien). */
export function completerUnite(brut: Record<string, unknown>): UniteLue {
  const u = brut as Partial<UniteLue> & { id: string; code: string };
  return {
    ...(u as UniteLue),
    code_interne: u.code_interne ?? null,
    profil: u.profil ?? null,
    nature: u.nature ?? null,
    nature_libelle: u.nature_libelle ?? null,
    temperature: u.temperature ?? null,
    temperature_libelle: u.temperature_libelle ?? null,
    temperature_releve: u.temperature_releve == null ? null : Number(u.temperature_releve),
    fragile: Boolean(u.fragile),
    urgent: Boolean(u.urgent),
    consigne: u.consigne ?? null,
    reference_client: u.reference_client ?? null,
    lot: u.lot ?? null,
    dlc: u.dlc ?? null,
    poids_kg: u.poids_kg == null ? null : Number(u.poids_kg),
    volume_m3: u.volume_m3 == null ? null : Number(u.volume_m3),
  };
}

/**
 * Retrouve une unité par son code PRINCIPAL ou par son code INTERNE complémentaire
 * (le scan résout les deux). Un code ne désigne jamais deux unités : la base le garantit.
 */
export async function trouverUniteParCode(supabase: SupabaseClient, organizationId: string, saisie: string): Promise<UniteLue | null> {
  const code = nettoyerCode(saisie);
  if (!code) return null;
  for (const colonne of ["code", "code_interne"] as const) {
    let r: { data: unknown; error: { code?: string | null; message: string } | null } = await supabase.from("stock_unites").select(COLONNES_UNITE).eq("organization_id", organizationId).eq(colonne, code).maybeSingle();
    if (r.error && colonneAbsente(r.error)) {
      if (colonne === "code_interne") return null;
      r = await supabase.from("stock_unites").select(COLONNES_UNITE_ANCIEN).eq("organization_id", organizationId).eq(colonne, code).maybeSingle();
    }
    if (r.error) throw new Error(r.error.message);
    if (r.data) return completerUnite(r.data as unknown as Record<string, unknown>);
  }
  return null;
}

/** Unités par identifiant (RLS : seules celles du périmètre de l'appelant reviennent). */
export async function unitesParIds(supabase: SupabaseClient, organizationId: string, ids: readonly string[]): Promise<UniteLue[]> {
  const res: UniteLue[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const lot = ids.slice(i, i + 100);
    let r: { data: unknown[] | null; error: { code?: string | null; message: string } | null } = await supabase.from("stock_unites").select(COLONNES_UNITE).eq("organization_id", organizationId).in("id", lot);
    if (r.error && colonneAbsente(r.error)) r = await supabase.from("stock_unites").select(COLONNES_UNITE_ANCIEN).eq("organization_id", organizationId).in("id", lot);
    if (r.error) throw new Error(r.error.message);
    res.push(...((r.data ?? []) as Record<string, unknown>[]).map(completerUnite));
  }
  // Ordre demandé conservé.
  const parId = new Map(res.map((u) => [u.id, u]));
  return ids.map((id) => parId.get(id)).filter((u): u is UniteLue => Boolean(u));
}


/**
 * Liste filtrée des unités (la RLS borne un manager à ses dépôts). `codesInstalles` : les
 * colonnes des codes et attributs existent (migrations 20261115 appliquées) ; sinon, ancien schéma.
 */
export function requeteUnites(supabase: SupabaseClient, organizationId: string, f: FiltresUnites, options: { codesInstalles: boolean; compter?: boolean }) {
  let r = supabase
    .from("stock_unites")
    .select(options.codesInstalles ? COLONNES_UNITE : COLONNES_UNITE_ANCIEN, options.compter ? { count: "exact" } : undefined)
    .eq("organization_id", organizationId);
  if (f.q) r = r.or(clauseRecherche(f.q, options.codesInstalles));
  if (f.statut) r = r.eq("statut", f.statut);
  if (f.site) r = r.eq("site_id", f.site);
  if (options.codesInstalles) {
    if (f.nature) r = r.eq("nature", f.nature);
    if (f.temperature) r = r.eq("temperature", f.temperature);
    if (f.urgent) r = r.eq("urgent", true);
    if (f.fragile) r = r.eq("fragile", true);
  }
  return r.order("updated_at", { ascending: false }).order("id");
}

export { PAR_PAGE_UNITES };
