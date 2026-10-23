import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi, refus } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { journaliser } from "@/lib/audit/journal";
import { lireEtatOffre } from "@/lib/go-navigation/etat";
import { enregistrerAccordUsage, MESSAGE_MIGRATION_ACCORD_USAGE } from "@/lib/go-navigation/accord-usage";
import { ACCORD_USAGE_VERSION } from "@/lib/go-navigation/offre";

const schema = z.object({ accepte: z.boolean() });

/**
 * « Mon compte » › Partage du détail d'usage (essai GO Navigation) : donner
 * ou retirer l'accord facultatif. Réservé à une personne connectée dont
 * l'organisation est un compte d'essai ; l'organisation vient de la session,
 * jamais du client. Date et texte exact posés côté serveur, action journalisée.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const { appUser, supabase } = g;
  if (!(await lireEtatOffre(supabase, appUser.organization_id)).goNavigation) {
    return refus("ROLE_REFUSE", "Ce réglage concerne uniquement les comptes d'essai GO Navigation.");
  }

  const r = await enregistrerAccordUsage(createAdminSupabaseClient(), appUser.organization_id, parsed.data.accepte);
  if (!r.ok) {
    return NextResponse.json({ error: r.migrationManquante ? MESSAGE_MIGRATION_ACCORD_USAGE : "Enregistrement impossible pour le moment. Réessayez dans un instant." }, { status: r.migrationManquante ? 503 : 500 });
  }

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "accord_usage_essai",
    targetTable: "organizations",
    targetId: appUser.organization_id,
    details: { accord: parsed.data.accepte, version: ACCORD_USAGE_VERSION, via: "mon_compte" },
  });
  return NextResponse.json({ accepte: parsed.data.accepte });
}
