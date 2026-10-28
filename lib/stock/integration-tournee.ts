import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { appelerMouvement, moduleStockActif } from "@/lib/stock/serveur";
import { synchroniserAlertesNonRentre } from "@/lib/stock/alertes-serveur";
import { actionPourArret, codeArret, sortiesAuDepart, type ActionStock, type UniteLiee } from "@/lib/stock/integration-tournee-logique";

/**
 * Lien entre la tournée colis et le stock. TOLÉRANT : appelé APRÈS l'action colis,
 * sans jamais la bloquer ni la faire échouer. Si le module Stock n'est pas actif,
 * si les migrations ne sont pas appliquées ou si un code n'est pas en stock, rien
 * ne se passe (au plus une ligne dans les journaux du serveur). Règles :
 * lib/stock/integration-tournee-logique.ts.
 */
type Utilisateur = { id: string; organization_id: string };

const TAILLE_LOT = 150;
const ACTIONS_MAX = 400;
const BUDGET_MS = 5000;
const SIMULTANEES = 6;

async function unitesParCode(supabase: SupabaseClient, organizationId: string, codes: readonly string[]): Promise<UniteLiee[]> {
  const res: UniteLiee[] = [];
  for (let i = 0; i < codes.length; i += TAILLE_LOT) {
    const { data, error } = await supabase.from("stock_unites").select("id, code, statut, site_id").eq("organization_id", organizationId).in("code", codes.slice(i, i + TAILLE_LOT));
    if (error) throw new Error(error.message);
    res.push(...((data ?? []) as UniteLiee[]));
  }
  return res;
}

async function executer(supabase: SupabaseClient, runId: string, actions: readonly ActionStock[]): Promise<number> {
  const debut = Date.now();
  let faits = 0;
  const file = actions.slice(0, ACTIONS_MAX);
  const travailleur = async () => {
    for (let a = file.shift(); a; a = file.shift()) {
      if (Date.now() - debut > BUDGET_MS) return;
      const r = await appelerMouvement(supabase, {
        p_cle: a.cle,
        p_type: a.type,
        p_site: a.site_id,
        p_unite_code: a.code,
        p_type_unite: null,
        p_article: null,
        p_quantite: 1,
        p_src: null,
        p_dest: null,
        p_lot: null,
        p_dlc: null,
        p_sens: null,
        p_statut_apres: a.statut_apres,
        p_motif: null,
        p_run: runId,
        p_stop: a.stop_id,
        p_poids: null,
        p_volume: null,
        p_sscc: null,
        p_source: "tournee",
      });
      if (r.ok) faits++;
      else console.warn("[stock] mouvement de tournée ignoré", a.code, r.code);
    }
  };
  await Promise.all(Array.from({ length: SIMULTANEES }, travailleur));
  return faits;
}

/** Départ de la tournée (statut « en cours ») : les colis en stock au dépôt sont sortis, liés à la tournée. */
export async function stockAuDepartTournee(supabase: SupabaseClient, appUser: Utilisateur, runId: string): Promise<void> {
  try {
    if (!(await moduleStockActif(supabase, appUser.organization_id))) return;
    const { data: arrets } = await supabase.from("delivery_stops").select("id, parcel_code, status").eq("run_id", runId).eq("organization_id", appUser.organization_id);
    const stops = (arrets ?? []) as { id: string; parcel_code: string | null; status: "pending" | "delivered" | "failed" }[];
    const codes = [...new Set(stops.map((s) => codeArret(s.parcel_code)).filter((c): c is string => Boolean(c)))];
    if (!codes.length) return;
    const actions = sortiesAuDepart(runId, stops, await unitesParCode(supabase, appUser.organization_id, codes));
    if (actions.length) await executer(supabase, runId, actions);
  } catch (e) {
    console.warn("[stock] sorties de départ de tournée ignorées", e instanceof Error ? e.message : e);
  }
}

/** Arrêt livré ou en échec : l'unité du colis passe « livrée » ou « retour ». */
export async function stockApresArret(supabase: SupabaseClient, appUser: Utilisateur, arret: { id: string; run_id: string; parcel_code?: string | null }, statut: "delivered" | "failed"): Promise<void> {
  try {
    if (!(await moduleStockActif(supabase, appUser.organization_id))) return;
    let parcel = arret.parcel_code;
    if (parcel === undefined) {
      const { data } = await supabase.from("delivery_stops").select("parcel_code").eq("id", arret.id).eq("organization_id", appUser.organization_id).maybeSingle();
      parcel = (data as { parcel_code?: string | null } | null)?.parcel_code ?? null;
    }
    const code = codeArret(parcel);
    if (!code) return;
    const unites = await unitesParCode(supabase, appUser.organization_id, [code]);
    const action = actionPourArret({ id: arret.id, parcel_code: code }, statut, unites);
    if (action) await executer(supabase, arret.run_id, [action]);
  } catch (e) {
    console.warn("[stock] mouvement d'arrêt ignoré", e instanceof Error ? e.message : e);
  }
}

/** Clôture de la tournée : alerte sur les unités encore en tournée, seuils de stock réévalués. */
export async function stockApresCloture(supabase: SupabaseClient, appUser: Utilisateur): Promise<void> {
  try {
    if (!(await moduleStockActif(supabase, appUser.organization_id))) return;
    const admin = createAdminSupabaseClient();
    await synchroniserAlertesNonRentre(admin, appUser.organization_id);
  } catch (e) {
    console.warn("[stock] alertes de clôture ignorées", e instanceof Error ? e.message : e);
  }
}
