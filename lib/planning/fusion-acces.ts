import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import type { AppUser } from "@/lib/auth/session";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { lireFusions, type FusionChargee } from "@/lib/planning/fusion-serveur";

/**
 * Garde commun des routes d'une tournée fusionnée (/api/planning/entries/[id]/
 * fusion, repartition, reconciliation) : connexion, module Planning, rôle
 * (direction, exploitation, manager), puis lecture de la ligne de planning
 * sous la RLS (un manager ne voit que les lignes de son service).
 */

export interface EntreeFusion {
  id: string;
  service_id: string;
  tour_number: string;
  driver_id: string | null;
  start_at: string;
  status: string;
}

export type ContexteFusion =
  | { ok: false; reponse: NextResponse }
  | { ok: true; appUser: AppUser; supabase: SupabaseClient; entree: EntreeFusion; fusion: FusionChargee | null };

export const MESSAGE_MIGRATION_FUSION = "Les tournées fusionnées demandent une mise à jour de la base (migration pas encore appliquée).";

export async function garderFusion(idBrut: string): Promise<ContexteFusion> {
  if (!z.string().uuid().safeParse(idBrut).success) return { ok: false, reponse: NextResponse.json({ error: "Affectation invalide." }, { status: 400 }) };
  const g = await garderApi({ modules: ["planning"], roles: ["direction", "exploitation", "manager"] });
  if (!g.ok) return { ok: false, reponse: g.reponse };
  const { data: entree, error } = await g.supabase
    .from("planning_entries")
    .select("id, service_id, tour_number, driver_id, start_at, status")
    .eq("id", idBrut)
    .eq("organization_id", g.appUser.organization_id)
    .maybeSingle();
  if (error) return { ok: false, reponse: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!entree) return { ok: false, reponse: NextResponse.json({ error: "Affectation introuvable." }, { status: 404 }) };
  const fusions = await lireFusions(g.supabase, g.appUser.organization_id, [idBrut]);
  return { ok: true, appUser: g.appUser, supabase: g.supabase, entree: entree as EntreeFusion, fusion: fusions.get(idBrut) ?? null };
}

/** Erreur d'écriture → réponse : 503 avec un message clair tant que la migration n'est pas appliquée. */
export function reponseErreurFusion(error: { code?: string | null; message: string }): NextResponse {
  if (estSchemaManquant(error)) return NextResponse.json({ error: MESSAGE_MIGRATION_FUSION }, { status: 503 });
  return NextResponse.json({ error: error.message }, { status: 500 });
}
