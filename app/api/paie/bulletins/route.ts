import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ROLES_GENERATION } from "@/lib/paie/validation";
import { paieIndisponible, paysOrganisation } from "@/lib/pays/serveur";
import { moisValide } from "@/lib/paie/donnees";
import { genererBulletinMois } from "@/lib/paie/generation-serveur";
import { variablesSchema } from "@/lib/paie/schemas";

export const maxDuration = 60;

const bodySchema = z.object({ user_id: z.string().uuid(), mois: z.string(), variables: variablesSchema });

/**
 * Calcule le bulletin du mois avec le moteur (lib/paie/calcul.ts), en
 * relisant côté serveur profil, réglages et cumuls — les chiffres
 * affichés à l'écran ne sont jamais repris tels quels du navigateur —,
 * génère le PDF et l'enregistre (lib/paie/generation-serveur.ts). Un bulletin
 * déjà généré pour ce mois est remplacé (correction) et repasse « en attente
 * de validation ».
 */
export async function POST(req: Request) {
  // Décision client Q1 : direction ET comptable génèrent ; le bulletin naît
  // « en attente de validation direction » (trigger payslips_guard_validation).
  const g = await garderApi({ roles: ROLES_GENERATION, modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  if (!pays.paie.moteur) return NextResponse.json({ error: paieIndisponible(pays) }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success || !moisValide(parsed.data.mois)) return NextResponse.json({ error: "Variables du mois invalides." }, { status: 400 });

  // La direction qui génère elle-même valide dans la foulée (c'est elle qui
  // valide) ; un bulletin du comptable attend sa décision.
  const r = await genererBulletinMois({ supabase, appUser, userId: parsed.data.user_id, mois: parsed.data.mois, variables: parsed.data.variables, validerSiDirection: true });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ id: r.id, netAPayer: r.netAPayer, validation: r.validation });
}
