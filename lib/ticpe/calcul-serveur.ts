import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { bornesPeriode } from "@/lib/ticpe/export";
import { appliquerPlafond, calculerPlein, type Depassement, type LigneTicpe, type PleinTicpe } from "@/lib/ticpe/montant";
import { chargerParametresTicpe, type ParametresTicpe } from "@/lib/ticpe/serveur";
import { evaluerFlotte, type VehiculeEvalue } from "@/lib/ticpe/vehicules-serveur";

export type PleinCharge = PleinTicpe & {
  unit_price?: number | string | null;
  vehicle_km?: number | string | null;
  driver_id?: string | null;
};

export interface Cuve {
  id: string;
  name: string;
  ticpe_zone: "metropole" | "corse" | null;
  avecFacture: boolean;
}

export interface CalculTicpe {
  parametres: ParametresTicpe;
  evalues: Map<string, VehiculeEvalue>;
  colonnesVehicule: boolean;
  /** Pleins de gazole chargés (tous statuts) des années couvertes. */
  pleins: Map<string, PleinCharge>;
  /** Une ligne par plein de gazole, plafond appliqué (années entières). */
  lignes: LigneTicpe[];
  depassements: Depassement[];
  cuves: Map<string, Cuve>;
  /** Trop de pleins : calcul incomplet. */
  tronque: boolean;
  annees: { debut: number; fin: number };
}

const COLONNES_PLEIN = "id, vehicle_id, driver_id, occurred_at, liters, unit_price, status, product, station_name, tank_id, ticket_photo_path, vehicle_km";

/**
 * Calcule la TICPE de l'organisation sur des années civiles entières
 * (le plafond par véhicule se compte sur l'année ou le semestre) :
 * pleins de gazole, éligibilité des véhicules, zone des cuves, factures
 * de livraison. Tolère les migrations TICPE non appliquées. Sous la RLS
 * de la personne connectée (ou le client service pour le cron).
 */
export async function calculerTicpe(
  supabase: SupabaseClient,
  organizationId: string,
  opts: { anneeDebut: number; anneeFin: number; vehicleIds?: readonly string[] },
): Promise<CalculTicpe> {
  const parametres = await chargerParametresTicpe(supabase, organizationId);
  const [{ evalues, colonnesTicpe }, cuves, pleinsRes] = await Promise.all([
    evaluerFlotte(supabase, organizationId, parametres.reglages, opts.vehicleIds),
    chargerCuves(supabase, organizationId),
    chargerPleins(supabase, organizationId, opts),
  ]);

  const brutes = pleinsRes.rows.map((p) => {
    const ev = evalues.get(p.vehicle_id);
    const cuve = p.tank_id ? cuves.get(p.tank_id) : undefined;
    return calculerPlein(p, {
      eligibilite: ev?.eligibilite ?? null,
      reglages: parametres.reglages,
      bareme: parametres.bareme,
      surcharges: parametres.surcharges,
      zoneCuve: cuve?.ticpe_zone ?? null,
      cuveAvecFacture: cuve?.avecFacture ?? false,
    });
  });
  const { lignes, depassements } = appliquerPlafond(brutes, parametres.reglages.plafond_litres, parametres.reglages.plafond_periode);
  return {
    parametres,
    evalues,
    colonnesVehicule: colonnesTicpe,
    pleins: new Map(pleinsRes.rows.map((p) => [p.id, p])),
    lignes,
    depassements,
    cuves,
    tronque: pleinsRes.truncated,
    annees: { debut: opts.anneeDebut, fin: opts.anneeFin },
  };
}

async function chargerPleins(supabase: SupabaseClient, organizationId: string, opts: { anneeDebut: number; anneeFin: number; vehicleIds?: readonly string[] }) {
  const { depuis, avant } = bornesPeriode(`${opts.anneeDebut}-01-01`, `${opts.anneeFin}-12-31`);
  const lire = (colonnes: string) =>
    fetchAllRows<PleinCharge>(
      (from, to) => {
        let q = supabase
          .from("fuel_entries")
          .select(colonnes)
          .eq("organization_id", organizationId)
          .eq("product", "gazole")
          .gte("occurred_at", depuis)
          .lt("occurred_at", avant)
          .order("occurred_at")
          .order("id")
          .range(from, to);
        if (opts.vehicleIds) q = q.in("vehicle_id", [...opts.vehicleIds]);
        return q as unknown as PromiseLike<{ data: PleinCharge[] | null; error: { message: string } | null }>;
      },
      { maxRows: 100000 },
    );
  if (opts.vehicleIds && opts.vehicleIds.length === 0) return { rows: [] as PleinCharge[], truncated: false };
  const complet = await lire(`${COLONNES_PLEIN}, ticpe_justificatif, ticpe_justificatif_ref`);
  if (!complet.error) return complet;
  if (!estSchemaManquant({ message: complet.error })) console.error("pleins TICPE", complet.error);
  return lire(COLONNES_PLEIN);
}

async function chargerCuves(supabase: SupabaseClient, organizationId: string): Promise<Map<string, Cuve>> {
  const [avecZone, livraisons] = await Promise.all([
    supabase.from("tanks").select("id, name, ticpe_zone").eq("organization_id", organizationId),
    fetchAllRows<{ tank_id: string }>((from, to) =>
      supabase.from("tank_deliveries").select("tank_id").eq("organization_id", organizationId).not("invoice_path", "is", null).order("tank_id").range(from, to),
    ),
  ]);
  const lignes = avecZone.error ? ((await supabase.from("tanks").select("id, name").eq("organization_id", organizationId)).data ?? []) : (avecZone.data ?? []);
  const factures = new Set(livraisons.rows.map((l) => l.tank_id));
  return new Map(
    (lignes as { id: string; name: string; ticpe_zone?: string | null }[]).map((t) => [
      t.id,
      { id: t.id, name: t.name, ticpe_zone: t.ticpe_zone === "corse" || t.ticpe_zone === "metropole" ? t.ticpe_zone : null, avecFacture: factures.has(t.id) },
    ]),
  );
}
