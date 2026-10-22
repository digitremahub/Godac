import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pleinsATraiter, tableAbsente, type AlerteLiee, type PleinPourEcarts } from "@/lib/fuel/ecarts";
import { fetchAllRows } from "@/lib/utils/fetch-all";

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

/** Fenêtre du compteur « écarts à traiter » : les pleins des 90 derniers jours. */
export const FENETRE_ECARTS_JOURS = 90;

export interface EcartsATraiter {
  /** Pleins à traiter, du plus récent au plus ancien. */
  ids: string[];
  /** Plus de pleins que la lecture n'en permet : compteur incomplet. */
  tronque: boolean;
}

/**
 * Compteur GLOBAL des écarts à traiter (pas seulement la page affichée) :
 * pleins des 90 derniers jours visibles par la personne connectée (RLS :
 * manager = son service, exploitation et direction = toute l'organisation),
 * écarts recalculés comme sur la page Pleins (lib/fuel/ecarts.ts).
 */
export async function chargerEcartsATraiter(
  supabase: SupabaseClient,
  filtres: { vehicule?: string | null; chauffeur?: string | null; du?: string | null; avant?: string | null } = {},
  jours = FENETRE_ECARTS_JOURS,
): Promise<EcartsATraiter> {
  const depuisFenetre = new Date(Date.now() - jours * 86400000).toISOString();
  const depuis = filtres.du && filtres.du > depuisFenetre ? filtres.du : depuisFenetre;
  type Ligne = PleinPourEcarts & { id: string };
  const { rows, truncated } = await fetchAllRows<Ligne>(
    (a, b) => {
      let q = supabase
        .from("fuel_entries")
        .select("id, liters, unit_price, totalizer_before, totalizer_after, totalizer_gap, gap_flagged, pmp_at_entry, tank_id, ocr_raw")
        .gte("occurred_at", depuis);
      if (filtres.vehicule) q = q.eq("vehicle_id", filtres.vehicule);
      if (filtres.chauffeur) q = q.eq("driver_id", filtres.chauffeur);
      if (filtres.avant) q = q.lt("occurred_at", filtres.avant);
      return q.order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(a, b) as unknown as PromiseLike<{ data: Ligne[] | null; error: { message: string } | null }>;
    },
    { maxRows: 20000 },
  );
  if (rows.length === 0) return { ids: [], tronque: truncated };
  // Une requête pour le journal, une pour les alertes de consommation (seul
  // type d'alerte qui crée un écart) : tous deux postérieurs au plein, donc
  // dans la même fenêtre.
  const [rev, al] = await Promise.all([
    fetchAllRows<{ fuel_entry_id: string; action: string; created_at: string }>((a, b) =>
      supabase.from("fuel_gap_reviews").select("fuel_entry_id, action, created_at").gte("created_at", depuisFenetre).order("created_at").order("id").range(a, b),
    ),
    fetchAllRows<{ related_id: string; type: string; message: string | null }>((a, b) =>
      supabase
        .from("alerts")
        .select("related_id, type, message")
        .eq("related_table", "fuel_entries")
        .eq("type", "consumption_anomaly")
        .gte("created_at", depuisFenetre)
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
  ]);
  if (rev.error && !tableAbsente({ message: rev.error })) console.error("fuel_gap_reviews", rev.error);
  const traitements = new Map<string, { action: string; created_at: string }[]>();
  for (const r of rev.rows) traitements.set(r.fuel_entry_id, [...(traitements.get(r.fuel_entry_id) ?? []), r]);
  const alertes = new Map<string, AlerteLiee[]>();
  for (const x of al.rows) alertes.set(x.related_id, [...(alertes.get(x.related_id) ?? []), x]);
  return { ids: pleinsATraiter(rows, alertes, traitements), tronque: truncated || rev.truncated || al.truncated };
}
