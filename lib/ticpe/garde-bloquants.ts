import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalculTicpe } from "@/lib/ticpe/calcul-serveur";
import { evaluerGeneration } from "@/lib/ticpe/bloquants";
import { controlesDeLaPeriode } from "@/lib/ticpe/periode-serveur";

/**
 * Garde commune aux routes 3310-TIC, ERA et dossier : calcule les points
 * bloquants de la période et refuse (409) tant que la personne n'a pas
 * confirmé « je génère malgré N points bloquants ».
 */
export async function garderBloquants(
  supabase: SupabaseClient,
  organizationId: string,
  calcul: CalculTicpe,
  periode: { debut: string; fin: string },
  confirme: number | null | undefined,
): Promise<{ reponse: NextResponse } | { reponse: null; pointsNonResolus: number; force: boolean }> {
  const { points } = await controlesDeLaPeriode(supabase, organizationId, { cle: `${periode.debut}_${periode.fin}`, libelle: "", ...periode }, calcul);
  const d = evaluerGeneration(points, confirme);
  if (d.statut === "bloque") return { reponse: NextResponse.json({ error: d.message, code: "POINTS_BLOQUANTS", bloquants: d.bloquants }, { status: 409 }) };
  return { reponse: null, pointsNonResolus: d.pointsNonResolus, force: d.force };
}
