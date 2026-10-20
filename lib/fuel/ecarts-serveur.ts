import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tableAbsente, type AlerteLiee } from "@/lib/fuel/ecarts";

/** Ligne de fuel_gap_reviews (migration 20261022000001). */
export interface LigneTraitementEcart {
  id: string;
  fuel_entry_id: string;
  action: string;
  commentaire: string;
  created_by: string;
  created_at: string;
}

export interface SuiviEcarts {
  /** Journal de traitement par plein, du plus ancien au plus récent. */
  traitements: Map<string, LigneTraitementEcart[]>;
  /** Alertes liées par plein (lisibles par la personne connectée). */
  alertes: Map<string, (AlerteLiee & { id: string; severity: string; status: string; created_at: string })[]>;
  /** false tant que la migration 20261022000001 n'est pas appliquée. */
  traitementDisponible: boolean;
}

function grouper<T extends { cle: string }>(lignes: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of lignes) {
    const liste = m.get(l.cle) ?? [];
    liste.push(l);
    m.set(l.cle, liste);
  }
  return m;
}

/**
 * Traitements et alertes des pleins donnés, sous la RLS de la personne
 * connectée. Tolère l'absence de la table fuel_gap_reviews (migration pas
 * encore appliquée) : journal vide et traitement indisponible.
 */
export async function chargerSuiviEcarts(supabase: SupabaseClient, entryIds: readonly string[]): Promise<SuiviEcarts> {
  if (entryIds.length === 0) return { traitements: new Map(), alertes: new Map(), traitementDisponible: true };
  const ids = [...entryIds];
  const [rev, al] = await Promise.all([
    supabase
      .from("fuel_gap_reviews")
      .select("id, fuel_entry_id, action, commentaire, created_by, created_at")
      .in("fuel_entry_id", ids)
      .order("created_at", { ascending: true }),
    supabase
      .from("alerts")
      .select("id, type, severity, message, status, created_at, related_id")
      .eq("related_table", "fuel_entries")
      .in("related_id", ids)
      .order("created_at", { ascending: true }),
  ]);

  const traitementDisponible = !tableAbsente(rev.error);
  if (rev.error && traitementDisponible) console.error("fuel_gap_reviews", rev.error.message);
  const traitements = new Map<string, LigneTraitementEcart[]>();
  for (const [cle, lignes] of grouper(((rev.error ? [] : rev.data) ?? []).map((r) => ({ ...(r as LigneTraitementEcart), cle: (r as LigneTraitementEcart).fuel_entry_id })))) {
    traitements.set(cle, lignes.map(({ cle: _cle, ...l }) => l));
  }

  type LigneAlerte = { id: string; type: string; severity: string; message: string | null; status: string; created_at: string; related_id: string };
  const alertes: SuiviEcarts["alertes"] = new Map();
  for (const [cle, lignes] of grouper(((al.data ?? []) as LigneAlerte[]).map((a) => ({ ...a, cle: a.related_id })))) {
    alertes.set(cle, lignes.map(({ cle: _cle, related_id: _r, ...a }) => a));
  }

  return { traitements, alertes, traitementDisponible };
}
