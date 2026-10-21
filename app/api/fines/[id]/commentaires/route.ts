import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { enregistrerCommentaire, lireFormulaireCommentaire } from "@/lib/rattachement/commentaires-serveur";
import { messageCommentaireEncadrement, messageExplicationChauffeur } from "@/lib/rattachement/notifications";
import { notifier } from "@/lib/rattachement/serveur";

/**
 * Explication (texte + photos) sur une amende. Le chauffeur désigné
 * l'ajoute depuis « Mes amendes » → l'encadrement du service du véhicule
 * est notifié ; l'encadrement peut répondre → le chauffeur est notifié.
 * Formulaire multipart : `texte`, `photos` (3 au plus).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: ["direction", "manager", "chauffeur"], modules: ["fines"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const { id } = await params;
  const form = await lireFormulaireCommentaire(req);
  if (!form) return NextResponse.json({ error: "Ajoutez une explication ou une photo." }, { status: 400 });

  // RLS « fines: read within org » : chauffeur désigné, encadrement de son service, direction.
  const { data: fine } = await supabase.from("fines").select("id, organization_id, driver_id, vehicles(service_id)").eq("id", id).maybeSingle();
  if (!fine) return NextResponse.json({ error: "Amende introuvable." }, { status: 404 });
  const estChauffeur = fine.driver_id === appUser.id;
  if (!estChauffeur && appUser.role === "chauffeur") return NextResponse.json({ error: "Amende introuvable." }, { status: 404 });

  const admin = createAdminSupabaseClient();
  const r = await enregistrerCommentaire(admin, { type: "fine", ficheId: id, organizationId: appUser.organization_id, auteurId: appUser.id, texte: form.texte, fichiers: form.fichiers });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const serviceId = (fine.vehicles as unknown as { service_id: string | null } | null)?.service_id ?? null;
  if (estChauffeur) {
    await notifier(admin, {
      organizationId: appUser.organization_id,
      type: "fine_notification",
      severity: "info",
      message: messageExplicationChauffeur(appUser.full_name, "amende", form.fichiers.length, form.texte),
      relatedTable: "fines",
      relatedId: id,
      recipientRoles: ["manager", "direction"],
      serviceId,
    });
  } else if (fine.driver_id) {
    await notifier(admin, {
      organizationId: appUser.organization_id,
      type: "fine_notification",
      severity: "info",
      message: messageCommentaireEncadrement(appUser.full_name, "amende", form.texte || "photo ajoutée"),
      relatedTable: "fines",
      relatedId: id,
      recipientUserId: fine.driver_id,
    });
  }
  return NextResponse.json({ ok: true, id: r.id });
}
