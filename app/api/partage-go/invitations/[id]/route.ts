import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { garderPartageGo, reponseErreurBase } from "@/lib/partage-go/serveur";

/**
 * Révoque une invitation « Faire essayer GO » pas encore utilisée : la
 * sienne, ou n'importe laquelle de l'organisation pour la direction.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invitation introuvable." }, { status: 404 });
  const g = await garderPartageGo();
  if (!g.ok) return g.reponse;
  const { appUser, admin } = g;

  let requete = admin
    .from("go_navigation_invitations")
    .update({ revoked_at: new Date().toISOString(), revoked_by_email: appUser.email.toLowerCase() })
    .eq("id", id)
    .eq("created_by_org_id", appUser.organization_id)
    .is("referral_link_id", null)
    .is("used_at", null)
    .is("revoked_at", null);
  if (appUser.role !== "direction") requete = requete.eq("created_by_user_id", appUser.id);
  const { data, error } = await requete.select("id").maybeSingle();
  if (error) return reponseErreurBase("révocation de l'invitation", error);
  if (!data) return NextResponse.json({ error: "Invitation déjà utilisée, révoquée ou introuvable." }, { status: 409 });

  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "go_apporteur_invitation_revoquee", targetTable: "go_navigation_invitations", targetId: id });
  return NextResponse.json({ ok: true });
}
