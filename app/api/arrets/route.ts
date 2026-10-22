import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { canManagePendingDriver } from "@/lib/auth/driver-signup-scope";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { estEncadrement } from "@/lib/roles/perimetre";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { parisDay } from "@/lib/utils/paris-time";
import { messageAlerteEncadrement, verifierDeclaration, dateCourte, type TypeDeclarable } from "@/lib/arrets/declaration";
import { affectationsPendantArret, lireArrets, notifierArret, serviceDuSalarie } from "@/lib/arrets/serveur";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.object({
  /** Saisie par l'encadrement ou la paie pour un salarié ; absent : son propre arrêt. */
  user_id: z.string().uuid().optional(),
  type: z.enum(["maladie", "at_mp", "trajet", "maternite", "paternite"]),
  du: date,
  au: date,
  /** Arrêt prolongé (prolongation) ; absent : arrêt initial. */
  prolonge_id: z.string().uuid().nullable().optional(),
  documents: z.array(z.string().min(1).max(300)).max(6).default([]),
});

const MESSAGE_MIGRATION = "La déclaration d'arrêt en ligne n'est pas encore activée pour votre entreprise : remettez votre avis à votre responsable.";

/**
 * Déclaration d'un arrêt de travail.
 *  - Le salarié déclare le sien (Mon espace › Arrêts) : statut « reçu »,
 *    au moins une photo du volet employeur ; l'encadrement du service est
 *    alerté avec le nombre de tournées à remplacer.
 *  - L'encadrement (son périmètre) ou la paie saisit l'arrêt d'un salarié
 *    (avis reçu en main propre) : directement « validé ».
 * La RLS (migration 20261030000001) reste l'autorité ; rien de médical
 * n'est reçu ni enregistré.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Déclaration incomplète : type, dates et photo de l'avis." }, { status: 400 });
  const d = parsed.data;

  const cibleId = d.user_id ?? appUser.id;
  const pourAutrui = cibleId !== appUser.id;
  if (pourAutrui) {
    if (!estEncadrement(appUser.role) && appUser.role !== "comptable") {
      return NextResponse.json({ error: "Seuls l'encadrement et la paie saisissent l'arrêt d'un autre salarié." }, { status: 403 });
    }
    if (appUser.role === "manager" && !(await canManagePendingDriver(supabase, appUser, cibleId))) {
      return NextResponse.json({ error: "Ce salarié n'est pas dans vos services." }, { status: 403 });
    }
  } else if (d.documents.length === 0) {
    return NextResponse.json({ error: "Ajoutez la photo du volet employeur de votre avis d'arrêt." }, { status: 400 });
  }

  const { data: cible } = await supabase.from("users").select("id, full_name").eq("id", cibleId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!cible) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });

  const prefixe = `${appUser.organization_id}/${cibleId}/`;
  if (d.documents.some((p) => !p.startsWith(prefixe) || p.includes(".."))) {
    return NextResponse.json({ error: "Document invalide." }, { status: 403 });
  }

  const existants = await lireArrets(supabase, { userId: cibleId });
  if (!existants.tableActive) return NextResponse.json({ error: MESSAGE_MIGRATION }, { status: 503 });
  const aujourdhui = parisDay();
  const verif = verifierDeclaration(
    { type: d.type, du: d.du, au: d.au, prolongeId: d.prolonge_id ?? null },
    existants.lignes.map((l) => ({ id: l.id, type: l.type, du: l.du, au: l.au, extensionOf: l.extensionOf, statut: l.statut })),
    aujourdhui,
  );
  if (!verif.ok) return NextResponse.json({ error: verif.erreur }, { status: 422 });

  // Service de rangement (lecture manager) : de préférence l'un des siens pour un manager.
  let mesServices: string[] = [];
  if (appUser.role === "manager") {
    const { data } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
    mesServices = ((data ?? []) as { service_id: string }[]).map((s) => s.service_id);
  }
  const serviceId = await serviceDuSalarie(supabase, cibleId, mesServices);
  const maintenant = new Date().toISOString();

  const base = {
    organization_id: appUser.organization_id,
    user_id: cibleId,
    stoppage_type: d.type,
    start_date: d.du,
    end_date: d.au,
    extension_of: verif.extensionOf,
    created_by: appUser.id,
  };
  const complet = {
    ...base,
    status: pourAutrui ? "valide" : "recu",
    document_paths: d.documents,
    service_id: serviceId,
    declared_by: appUser.id,
    ...(pourAutrui ? { validated_by: appUser.id, validated_at: maintenant } : {}),
  };
  let { data: ligne, error } = await supabase.from("work_stoppages").insert(complet).select("id").single();
  if (error && estSchemaManquant(error)) {
    // Migration 20261030000001 absente : seule la paie (ancienne RLS) peut encore saisir, sans document.
    if (!pourAutrui || !(appUser.role === "direction" || appUser.role === "comptable")) return NextResponse.json({ error: MESSAGE_MIGRATION }, { status: 503 });
    ({ data: ligne, error } = await supabase.from("work_stoppages").insert(base).select("id").single());
  }
  if (error || !ligne) {
    console.error("arrêts : enregistrement impossible", error?.message);
    return NextResponse.json({ error: error?.code === "42501" ? "Enregistrement refusé pour ce salarié." : "Enregistrement impossible, réessayez." }, { status: error?.code === "42501" ? 403 : 500 });
  }

  // Effet planning : tournées encore à faire pendant l'arrêt (rien n'est retiré ici).
  const admin = createAdminSupabaseClient();
  const touchees = await affectationsPendantArret(admin, appUser.organization_id, cibleId, d.du, d.au);
  await notifierArret(admin, {
    organizationId: appUser.organization_id,
    arretId: ligne.id,
    serviceId,
    severity: touchees.length > 0 ? "warning" : "info",
    message: messageAlerteEncadrement({
      nom: cible.full_name ?? "Un salarié",
      du: d.du,
      au: d.au,
      tournees: touchees.length,
      prolongation: Boolean(d.prolonge_id),
      accidentTravail: (d.type as TypeDeclarable) === "at_mp",
      parEncadrement: pourAutrui,
    }),
  });
  if (pourAutrui) {
    await notifierArret(admin, {
      organizationId: appUser.organization_id,
      arretId: ligne.id,
      recipientUserId: cibleId,
      severity: "info",
      message: `Votre arrêt de travail du ${dateCourte(d.du)} au ${dateCourte(d.au)} a été enregistré par ${appUser.full_name ?? "votre responsable"}.`,
    });
  }

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "arret_declare",
    targetTable: "work_stoppages",
    targetId: ligne.id,
    details: { salarie: cibleId, du: d.du, au: d.au, prolongation: Boolean(d.prolonge_id), documents: d.documents.length, tournees: touchees.length, par: appUser.role },
  });

  return NextResponse.json({ id: ligne.id, statut: pourAutrui ? "valide" : "recu", tournees: touchees.length });
}
