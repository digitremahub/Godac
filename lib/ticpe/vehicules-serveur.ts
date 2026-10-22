import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { VEHICLE_DOC_TYPES } from "@/lib/vehicles/document-types";
import { eligibiliteVehicule, type ResultatEligibilite, type VehiculeEligibilite } from "@/lib/ticpe/eligibilite";
import type { ReglagesTicpe } from "@/lib/ticpe/reglages";

/** Libellé exact du type de document « carte grise » (vehicle_documents.doc_type). */
export const DOC_CARTE_GRISE = VEHICLE_DOC_TYPES[0];

const COLONNES_BASE = "id, registration, type, ptac_kg, fuel_type, spec_sources, ownership, rental_start_date, rental_end_date, status, tank_capacity_liters, service_id, created_at";
const COLONNES_TICPE = "ticpe_categorie, pays_immatriculation, ticpe_location_demandeur, flotte_entree_le, flotte_sortie_le, cg_genre, cg_energie, cg_premiere_immat, cg_confirmee_le";

export type VehiculeTicpe = VehiculeEligibilite & {
  id: string;
  registration: string;
  status?: string | null;
  tank_capacity_liters?: number | string | null;
  service_id?: string | null;
  cg_premiere_immat?: string | null;
};

/**
 * Véhicules de l'organisation (RLS de la personne connectée) avec les
 * colonnes TICPE ; si la migration 20261031000002 n'est pas appliquée,
 * retombe sur les colonnes historiques (`colonnesTicpe: false`).
 */
export async function chargerVehiculesTicpe(supabase: SupabaseClient, ids?: readonly string[]): Promise<{ vehicules: VehiculeTicpe[]; colonnesTicpe: boolean }> {
  const lire = (colonnes: string) =>
    fetchAllRows<VehiculeTicpe>((from, to) => {
      let q = supabase.from("vehicles").select(colonnes).order("registration").order("id").range(from, to);
      if (ids) q = q.in("id", [...ids]);
      return q as unknown as PromiseLike<{ data: VehiculeTicpe[] | null; error: { message: string } | null }>;
    });
  if (ids && ids.length === 0) return { vehicules: [], colonnesTicpe: true };
  const complet = await lire(`${COLONNES_BASE}, ${COLONNES_TICPE}`);
  if (!complet.error) return { vehicules: complet.rows, colonnesTicpe: true };
  if (!estSchemaManquant({ message: complet.error })) console.error("vehicules TICPE", complet.error);
  const base = await lire(COLONNES_BASE);
  return { vehicules: base.rows, colonnesTicpe: false };
}

/** Véhicules dont une carte grise est jointe (vehicle_documents, lisible par l'encadrement et le comptable). */
export async function vehiculesAvecCarteGrise(supabase: SupabaseClient): Promise<Set<string>> {
  const { rows } = await fetchAllRows<{ vehicle_id: string }>((from, to) =>
    supabase.from("vehicle_documents").select("vehicle_id").eq("doc_type", DOC_CARTE_GRISE).order("vehicle_id").range(from, to),
  );
  return new Set(rows.map((r) => r.vehicle_id));
}

export interface VehiculeEvalue {
  vehicule: VehiculeTicpe;
  eligibilite: ResultatEligibilite;
  aCarteGrise: boolean;
}

/** Éligibilité de chaque véhicule de l'organisation. */
export async function evaluerFlotte(supabase: SupabaseClient, reglages: ReglagesTicpe, ids?: readonly string[]): Promise<{ evalues: Map<string, VehiculeEvalue>; colonnesTicpe: boolean }> {
  const [{ vehicules, colonnesTicpe }, cartes] = await Promise.all([chargerVehiculesTicpe(supabase, ids), vehiculesAvecCarteGrise(supabase)]);
  const evalues = new Map<string, VehiculeEvalue>();
  for (const v of vehicules) {
    const aCarteGrise = cartes.has(v.id);
    evalues.set(v.id, { vehicule: v, aCarteGrise, eligibilite: eligibiliteVehicule(v, { reglages, aCarteGrise }) });
  }
  return { evalues, colonnesTicpe };
}
