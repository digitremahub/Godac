import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { enregistrerCommentaire, lireFormulaireCommentaire } from "@/lib/rattachement/commentaires-serveur";
import { messageCommentaireEncadrement, messageExplicationChauffeur } from "@/lib/rattachement/notifications";
import { notifier, serviceDuChauffeur } from "@/lib/rattachement/serveur";

/**
 * Explication (texte + photos) sur une contestation client : le chauffeur
 * attributaire l'ajoute → l'encadrement de son service est notifié ;
 * l'encadrement peut répondre → le chauffeur est notifié.
 * Formulaire multipart : `texte`, `photos` (3 au plus).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ modules: ["customer_disputes"] });
  if (!g.ok) return g.reponse;
  const { appUser } = g;
  const { id } = await params;
  const form = await lireFormulaireCommentaire(req);
  if (!form) return NextResponse.json({ error: "Ajoutez une explication ou une photo." }, { status: 400 });

  // RLS : encadrement de l'organisation, ou chauffeur attributaire (hors « à valider »).
  const supabase = await createServerSupabaseClient();
  const { data: c } = await supabase.from("customer_disputes").select("id, driver_id, status, client_name, parcel_code").eq("id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "Contestation introuvable." }, { status: 404 });
  const estChauffeur = c.driver_id === appUser.id;
  if (!estChauffeur && !hasRole(appUser.role, ["manager", "direction"])) return NextResponse.json({ error: "Contestation introuvable." }, { status: 404 });

  const admin = createAdminSupabaseClient();
  const r = await enregistrerCommentaire(admin, { type: "dispute", ficheId: id, organizationId: appUser.organization_id, auteurId: appUser.id, texte: form.texte, fichiers: form.fichiers });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  if (estChauffeur) {
    await notifier(admin, {
      organizationId: appUser.organization_id,
      type: "customer_dispute",
      severity: "info",
      message: messageExplicationChauffeur(appUser.full_name, "contestation", form.fichiers.length, form.texte),
      relatedTable: "customer_disputes",
      relatedId: id,
      recipientRoles: ["manager", "direction"],
      serviceId: await serviceDuChauffeur(admin, appUser.id),
    });
  } else if (c.driver_id) {
    await notifier(admin, {
      organizationId: appUser.organization_id,
      type: "customer_dispute",
      severity: "info",
      message: messageCommentaireEncadrement(appUser.full_name, "contestation", form.texte || "photo ajoutée"),
      relatedTable: "customer_disputes",
      relatedId: id,
      recipientUserId: c.driver_id,
    });
  }
  return NextResponse.json({ ok: true, id: r.id });
}
