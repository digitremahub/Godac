import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { appliquerInfosEntreprise, infosEntrepriseSchema } from "@/lib/organization/entreprise-serveur";
import { CLES_FICHE } from "@/lib/organization/fiche-entreprise";

const bodySchema = z.object({
  entreprise: infosEntrepriseSchema,
  /** Champs déjà renseignés que la direction a choisi de remplacer. */
  remplacer: z.array(z.enum(CLES_FICHE as [string, ...string[]])).default([]),
});

/**
 * Applique la fiche SIRENE lue par /api/entreprise/recherche à
 * l'organisation (Organisation › Identité de l'entreprise). Direction
 * uniquement, comme le reste du profil de l'organisation et les
 * réglages de paie (RLS).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Fiche entreprise invalide." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  try {
    const bilan = await appliquerInfosEntreprise(supabase, appUser.organization_id, parsed.data.entreprise, parsed.data.remplacer);
    return NextResponse.json({ bilan });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur inattendue" }, { status: 500 });
  }
}
