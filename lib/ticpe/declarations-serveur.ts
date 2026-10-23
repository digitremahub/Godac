import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { declarationDuJour } from "@/lib/ticpe/regularisation";

export interface LigneDeclaration {
  id: string;
  periode_cle: string;
  periode_libelle: string | null;
  periode_debut: string;
  periode_fin: string;
  regime_tva: string;
  declaree_le: string;
  montant: number;
  litres: number | null;
  montant_calcule: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  annulee_le: string | null;
}

/** Déclarations TICPE de l'organisation (tolère la migration 20261031000003 non appliquée). */
export async function chargerDeclarations(supabase: SupabaseClient, organizationId: string): Promise<{ declarations: LigneDeclaration[]; disponible: boolean }> {
  const { data, error } = await supabase
    .from("ticpe_declarations")
    .select("id, periode_cle, periode_libelle, periode_debut, periode_fin, regime_tva, declaree_le, montant, litres, montant_calcule, note, created_by, created_at, annulee_le")
    .eq("organization_id", organizationId)
    .order("periode_debut", { ascending: false });
  if (error) {
    if (!estSchemaManquant(error)) console.error("ticpe_declarations", error.message);
    return { declarations: [], disponible: false };
  }
  return {
    declarations: ((data ?? []) as any[]).map((d) => ({
      ...d,
      montant: Number(d.montant),
      litres: d.litres === null ? null : Number(d.litres),
      montant_calcule: d.montant_calcule === null ? null : Number(d.montant_calcule),
    })),
    disponible: true,
  };
}

/**
 * Déclaration non annulée qui couvre l'un de ces jours (AAAA-MM-JJ de Paris), sinon null.
 * Tolère la migration 20261031000003 non appliquée (null).
 */
export async function declarationCouvrant(supabase: SupabaseClient, organizationId: string, jours: readonly string[]): Promise<LigneDeclaration | null> {
  const { declarations, disponible } = await chargerDeclarations(supabase, organizationId);
  if (!disponible) return null;
  for (const j of jours) {
    const d = declarationDuJour(j, declarations);
    if (d) return d;
  }
  return null;
}
