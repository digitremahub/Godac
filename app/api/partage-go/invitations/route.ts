import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { genererJetonInvitation, hacherJetonInvitation } from "@/lib/go-navigation/jeton";
import { expirationInvitation, normaliserNote } from "@/lib/go-navigation/offre";
import { limiteCreationAtteinte } from "@/lib/partage-go/apporteur";
import { compterCreations24h, garderPartageGo, MESSAGE_LIMITE_CREATION, reponseErreurBase } from "@/lib/partage-go/serveur";

const bodySchema = z.object({ note: z.string().max(200).optional() });

/**
 * « Faire essayer GO » : crée une invitation à USAGE UNIQUE (30 jours) avec
 * une note, attribuée à la personne connectée et à son organisation. Seul le
 * hash du jeton est enregistré ; le chemin complet n'est renvoyé qu'ici.
 */
export async function POST(req: Request) {
  const g = await garderPartageGo();
  if (!g.ok) return g.reponse;
  const { appUser, admin } = g;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Note invalide (200 caractères maximum)." }, { status: 400 });

  const { total, error: errCompte } = await compterCreations24h(admin, appUser.id);
  if (errCompte) return reponseErreurBase("comptage", errCompte);
  if (limiteCreationAtteinte(total)) return NextResponse.json({ error: MESSAGE_LIMITE_CREATION }, { status: 429 });

  const jeton = genererJetonInvitation();
  const { data, error } = await admin
    .from("go_navigation_invitations")
    .insert({
      token_hash: hacherJetonInvitation(jeton),
      note: normaliserNote(parsed.data.note),
      expires_at: expirationInvitation().toISOString(),
      created_by_email: appUser.email.toLowerCase(),
      created_by_user_id: appUser.id,
      created_by_org_id: appUser.organization_id,
    })
    .select("id, note, expires_at, created_at")
    .single();
  if (error) return reponseErreurBase("création de l'invitation", error);

  // Jamais le jeton dans le journal.
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "go_apporteur_invitation_creee", targetTable: "go_navigation_invitations", targetId: data.id as string });
  return NextResponse.json({ invitation: data, chemin: `/go-navigation/${jeton}` });
}
