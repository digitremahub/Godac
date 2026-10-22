import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { calculerTicpe, type CalculTicpe } from "@/lib/ticpe/calcul-serveur";
import { controlesPeriode, type PointARegler, type VehiculeControle } from "@/lib/ticpe/controles";
import { periodeContenant, prochaineEcheance, type PeriodeDeclaration } from "@/lib/ticpe/echeances";
import type { ReglagesTicpe } from "@/lib/ticpe/reglages";
import { bornesPeriode } from "@/lib/ticpe/export";

/** Période demandée (?periode=2026-03 / 2026-T1 / 2026, ou ?du=&au=), sinon celle de la prochaine échéance. */
export function periodeDemandee(params: { periode?: string; du?: string; au?: string }, reglages: ReglagesTicpe, aujourdhui: string): PeriodeDeclaration {
  const jour = /^\d{4}-\d{2}-\d{2}$/;
  if (params.du && params.au && jour.test(params.du) && jour.test(params.au) && params.du <= params.au) {
    return { cle: `${params.du}_${params.au}`, debut: params.du, fin: params.au, libelle: `du ${params.du.split("-").reverse().join("/")} au ${params.au.split("-").reverse().join("/")}` };
  }
  const p = params.periode ?? "";
  const regime = reglages.regime_tva;
  let m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m && regime === "mensuel") return periodeContenant(`${m[1]}-${m[2]}-01`, regime);
  m = /^(\d{4})-T([1-4])$/.exec(p);
  if (m && regime === "trimestriel") return periodeContenant(`${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, "0")}-01`, regime);
  m = /^(\d{4})$/.exec(p);
  if (m && regime === "annuel_ca12") return periodeContenant(`${m[1]}-01-01`, regime);
  return prochaineEcheance(aujourdhui, reglages).periode;
}

export function vehiculesPourControles(calcul: CalculTicpe): Map<string, VehiculeControle> {
  return new Map(
    [...calcul.evalues.entries()].map(([id, e]) => [id, { registration: e.vehicule.registration, tank_capacity_liters: e.vehicule.tank_capacity_liters ?? null, eligibilite: e.eligibilite }]),
  );
}

/** Pleins de la période liés à une alerte de consommation anormale non résolue (écarts carburant existants). */
async function anomaliesConsommation(supabase: SupabaseClient, periode: PeriodeDeclaration): Promise<Set<string>> {
  const { depuis } = bornesPeriode(periode.debut, periode.fin);
  const { rows } = await fetchAllRows<{ related_id: string }>((from, to) =>
    supabase
      .from("alerts")
      .select("related_id")
      .eq("type", "consumption_anomaly")
      .eq("related_table", "fuel_entries")
      .neq("status", "resolved")
      .gte("created_at", depuis)
      .order("id")
      .range(from, to),
  );
  return new Set(rows.map((r) => r.related_id).filter(Boolean));
}

/** Calcul (années entières couvrant la période) et liste « à régler » de la période. */
export async function controlesDeLaPeriode(
  supabase: SupabaseClient,
  organizationId: string,
  periode: PeriodeDeclaration,
  calculExistant?: CalculTicpe,
): Promise<{ calcul: CalculTicpe; points: PointARegler[] }> {
  const calcul =
    calculExistant ?? (await calculerTicpe(supabase, organizationId, { anneeDebut: Number(periode.debut.slice(0, 4)), anneeFin: Number(periode.fin.slice(0, 4)) }));
  const anomalies = await anomaliesConsommation(supabase, periode);
  const points = controlesPeriode({
    periode,
    lignes: calcul.lignes,
    pleins: calcul.pleins,
    vehicules: vehiculesPourControles(calcul),
    depassements: calcul.depassements,
    anomaliesConsommation: anomalies,
  });
  return { calcul, points };
}
