import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { BAREME_PAR_DEFAUT, normaliserLigne, type LigneBareme, type SurchargeBareme } from "@/lib/ticpe/bareme";
import { normaliserReglages, type ReglagesTicpe } from "@/lib/ticpe/reglages";

/**
 * Lecture des réglages, du barème et des surcharges TICPE, tolérante à
 * une migration non appliquée (20261031000001) : réglages par défaut et
 * barème intégré (copie du barème semé), signalés par `migrationManquante`.
 */
export interface ParametresTicpe {
  reglages: ReglagesTicpe;
  /** true : une ligne ticpe_settings existe (réglages enregistrés au moins une fois). */
  reglagesEnregistres: boolean;
  bareme: LigneBareme[];
  surcharges: (SurchargeBareme & { id: string; created_at?: string; created_by?: string | null; revoked_by?: string | null })[];
  /** true : tables absentes, valeurs par défaut utilisées. */
  migrationManquante: boolean;
}

export async function chargerParametresTicpe(supabase: SupabaseClient, organizationId: string): Promise<ParametresTicpe> {
  const [reg, bar, sur] = await Promise.all([
    supabase.from("ticpe_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
    supabase
      .from("ticpe_rates")
      .select("id, categorie, zone, date_debut, date_fin, taux_eur_hl, source, source_url, verifie_le, a_confirmer, note")
      .order("categorie")
      .order("date_debut"),
    supabase
      .from("ticpe_rate_overrides")
      .select("id, categorie, zone, date_debut, date_fin, taux_eur_hl, motif, created_at, created_by, revoked_at, revoked_by")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
  ]);
  const manque = estSchemaManquant(reg.error) || estSchemaManquant(bar.error);
  for (const e of [reg.error, bar.error, sur.error]) if (e && !estSchemaManquant(e)) console.error("ticpe paramètres", e.message);
  const bareme = !bar.error && (bar.data ?? []).length > 0 ? (bar.data as any[]).map((l) => normaliserLigne(l) as LigneBareme) : [...BAREME_PAR_DEFAUT];
  return {
    reglages: normaliserReglages(reg.error ? null : (reg.data as Record<string, unknown> | null)),
    reglagesEnregistres: Boolean(!reg.error && reg.data),
    bareme,
    surcharges: sur.error ? [] : ((sur.data ?? []) as any[]).map((s) => ({ ...s, taux_eur_hl: Number(s.taux_eur_hl) })),
    migrationManquante: manque,
  };
}
