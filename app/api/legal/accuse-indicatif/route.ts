import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { lireAccuseIndicatif } from "@/lib/legal/accuse-indicatif-serveur";
import { VERSION_MENTION_INDICATIVE } from "@/lib/legal/mention-indicative";

export const dynamic = "force-dynamic";

/**
 * Accusé de lecture, par organisation, de la mention « documents indicatifs »
 * (paie, TICPE, carburant). Donné par la direction ou le comptable, tracé dans
 * le journal d'audit existant (pas de table dédiée) ; un seul accusé par
 * version du texte : s'il existe déjà, rien n'est ajouté.
 */
export async function POST() {
  const g = await garderApi({ roles: ["direction", "comptable"] });
  if (!g.ok) return g.reponse;
  const { appUser } = g;
  const existant = await lireAccuseIndicatif(appUser.organization_id);
  if (existant) return NextResponse.json({ ok: true, ...existant });
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "accuse_parametres_indicatifs",
    details: { version: VERSION_MENTION_INDICATIVE, nom: appUser.full_name, role: appUser.role },
  });
  // journaliser() n'échoue jamais bruyamment : on relit pour ne pas annoncer un accusé non enregistré.
  const enregistre = await lireAccuseIndicatif(appUser.organization_id);
  if (!enregistre) return NextResponse.json({ error: "Enregistrement impossible, réessayez dans un instant." }, { status: 500 });
  return NextResponse.json({ ok: true, ...enregistre });
}
