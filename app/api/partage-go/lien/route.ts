import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { hacherJetonInvitation } from "@/lib/go-navigation/jeton";
import { expirationLienApporteur, limiteCreationAtteinte, MAX_INSCRIPTIONS_LIEN } from "@/lib/partage-go/apporteur";
import { cheminLienPersonnel, compterCreations24h, garderPartageGo, jetonLienPersonnel, MESSAGE_LIMITE_CREATION, reponseErreurBase } from "@/lib/partage-go/serveur";

/**
 * « Faire essayer GO » : crée ou régénère MON lien personnel (multi-usage,
 * 90 jours, 20 inscriptions). L'ancien lien actif est révoqué (un seul lien
 * actif par personne). Réservé aux personnes autorisées ; 10 liens ou
 * invitations par jour et par personne.
 */
export async function POST() {
  const g = await garderPartageGo();
  if (!g.ok) return g.reponse;
  const { appUser, admin } = g;

  const { total, error: errCompte } = await compterCreations24h(admin, appUser.id);
  if (errCompte) return reponseErreurBase("comptage", errCompte);
  if (limiteCreationAtteinte(total)) return NextResponse.json({ error: MESSAGE_LIMITE_CREATION }, { status: 429 });

  const maintenant = new Date();
  const { error: errRevoque } = await admin
    .from("go_apporteur_liens")
    .update({ revoked_at: maintenant.toISOString() })
    .eq("user_id", appUser.id)
    .is("revoked_at", null);
  if (errRevoque) return reponseErreurBase("révocation de l'ancien lien", errRevoque);

  const id = randomUUID();
  let chemin: string;
  try {
    chemin = cheminLienPersonnel(id);
  } catch (e) {
    console.error("partage-go (secret)", e);
    return NextResponse.json({ error: "Lien indisponible pour le moment." }, { status: 503 });
  }
  const { error } = await admin.from("go_apporteur_liens").insert({
    id,
    organization_id: appUser.organization_id,
    user_id: appUser.id,
    code_hash: hacherJetonInvitation(jetonLienPersonnel(id)),
    max_inscriptions: MAX_INSCRIPTIONS_LIEN,
    expires_at: expirationLienApporteur(maintenant).toISOString(),
  });
  if (error) return reponseErreurBase("création du lien", error);

  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "go_apporteur_lien_cree", targetTable: "go_apporteur_liens", targetId: id });
  return NextResponse.json({ chemin });
}

/** Révoque mon lien personnel actif : il ne sert plus à s'inscrire (les comptes déjà créés restent attribués). */
export async function DELETE() {
  const g = await garderPartageGo();
  if (!g.ok) return g.reponse;
  const { appUser, admin } = g;

  const { data, error } = await admin
    .from("go_apporteur_liens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", appUser.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return reponseErreurBase("révocation du lien", error);
  if (!data) return NextResponse.json({ error: "Aucun lien actif à révoquer." }, { status: 409 });

  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "go_apporteur_lien_revoque", targetTable: "go_apporteur_liens", targetId: data.id as string });
  return NextResponse.json({ ok: true });
}
