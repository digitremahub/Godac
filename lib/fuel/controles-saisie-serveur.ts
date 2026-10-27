import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVehicleKmReadingsAround } from "@/lib/vehicles/odometer-reference";
import {
  CODE_CONTROLE_A_CONFIRMER,
  construireConfirmation,
  controleCapacite,
  controlesKilometrage,
  messageControles,
  motifControleValide,
  type ControleConfirme,
  type ControleSaisie,
} from "@/lib/fuel/controles-saisie";

/**
 * Contrôles de saisie d'un plein, mêmes règles pour la création et pour la
 * validation / correction (lib/fuel/controles-saisie.ts). `db` : client qui voit
 * toutes les tournées du véhicule (client admin, véhicule déjà vérifié dans
 * l'organisation) ; la RLS limiterait un chauffeur à ses propres tournées.
 */
export async function evaluerControlesSaisie(
  db: SupabaseClient,
  params: {
    vehicle: { id: string; tank_capacity_liters?: number | string | null; adblue_capacity_liters?: number | string | null };
    liters?: number | null;
    product: "gazole" | "adblue";
    km?: number | null;
    occurredAt: string;
    excludeFuelEntryId?: string;
  },
): Promise<ControleSaisie[]> {
  const controles: ControleSaisie[] = [];
  if (params.liters != null) {
    const c = controleCapacite({ liters: params.liters, product: params.product, capaciteLitres: Number(params.product === "adblue" ? params.vehicle.adblue_capacity_liters : params.vehicle.tank_capacity_liters) || null });
    if (c) controles.push(c);
  }
  if (params.km != null) {
    // Saisie rétroactive : comparer aux relevés connus à la date réelle du plein, pas au relevé actuel.
    const { avant, apres } = await getVehicleKmReadingsAround(db, params.vehicle.id, params.occurredAt, params.excludeFuelEntryId);
    controles.push(...controlesKilometrage({ km: params.km, occurredAt: params.occurredAt, avant, apres }));
  }
  return controles;
}

/**
 * Suite à donner aux contrôles : aucun échec, ou confirmation valide (motif) →
 * on continue (avec la confirmation à enregistrer) ; sinon réponse 409
 * « à confirmer » avec la liste, que l'écran affiche avec un champ motif.
 */
export function suiteControles(controles: readonly ControleSaisie[], confirmation: { motif: string } | undefined, userId: string): { reponse: NextResponse } | { confirme: ControleConfirme | null } {
  if (controles.length === 0) return { confirme: null };
  if (confirmation && motifControleValide(confirmation.motif)) return { confirme: construireConfirmation(controles, confirmation.motif, userId) };
  return {
    reponse: NextResponse.json(
      {
        error: confirmation ? "Précisez un motif court (3 caractères au moins) pour confirmer." : messageControles(controles),
        code: CODE_CONTROLE_A_CONFIRMER,
        controles,
      },
      { status: 409 },
    ),
  };
}
