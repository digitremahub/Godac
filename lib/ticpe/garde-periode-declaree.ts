import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { declarationCouvrant } from "@/lib/ticpe/declarations-serveur";
import { jourParis } from "@/lib/ticpe/montant";
import { messagePeriodeDeclaree } from "@/lib/ticpe/regularisation";

/**
 * Avant de modifier un plein dont la date tombe dans une période TICPE déjà
 * déclarée : refuse (409, code PERIODE_DECLAREE) tant que la personne n'a pas
 * confirmé. Sinon renvoie le nom de la période (à consigner au journal).
 */
export async function verifierPeriodeDeclaree(
  supabase: SupabaseClient,
  organizationId: string,
  occurredAt: string,
  confirme: boolean | undefined,
): Promise<{ reponse: NextResponse } | { reponse: null; periodeDeclaree: string | null }> {
  const decl = await declarationCouvrant(supabase, organizationId, [jourParis(occurredAt)]);
  if (!decl) return { reponse: null, periodeDeclaree: null };
  const nom = decl.periode_libelle ?? decl.periode_cle;
  if (!confirme) return { reponse: NextResponse.json({ error: messagePeriodeDeclaree(decl), code: "PERIODE_DECLAREE", periodeDeclaree: nom }, { status: 409 }) };
  return { reponse: null, periodeDeclaree: nom };
}
