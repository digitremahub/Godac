import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { moisValide } from "@/lib/paie/donnees";
import { preparerPaieDuMois } from "@/lib/paie/lot-serveur";
import { resumeLot } from "@/lib/paie/lot";
import { paieIndisponible, paysOrganisation } from "@/lib/pays/serveur";

export const maxDuration = 300;

const bodySchema = z.object({ mois: z.string() });

/**
 * « Préparer tous les bulletins du mois » : direction et comptable (écran
 * « Préparer la paie du mois », module Paie), comme la génération unitaire.
 * Les bulletins naissent « en attente de validation » : la validation reste à
 * la direction (/api/paie/bulletins/validation), même quand c'est elle qui
 * prépare. Tracé au journal d'audit (lib/paie/lot-serveur.ts).
 */
export async function POST(req: Request) {
  const g = await garderApi({ ecran: "equipe.paie_preparer" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  if (!pays.paie.moteur) return NextResponse.json({ error: paieIndisponible(pays) }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !moisValide(parsed.data.mois)) return NextResponse.json({ error: "Mois invalide." }, { status: 400 });
  try {
    const bilan = await preparerPaieDuMois(supabase, appUser, parsed.data.mois);
    return NextResponse.json({ ...bilan, resume: resumeLot(bilan) });
  } catch (e) {
    console.error("paie en lot", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Préparation impossible." }, { status: 500 });
  }
}
