import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { parisDay } from "@/lib/utils/paris-time";
import { messageDecisionSalarie, verifierDeclaration } from "@/lib/arrets/declaration";
import { lireArrets, notifierArret } from "@/lib/arrets/serveur";
import { garderDecision, tracerAutoValidation } from "@/lib/hierarchie/serveur";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("valider") }),
  z.object({ action: z.literal("refuser"), motif: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("modifier"), type: z.enum(["maladie", "at_mp", "trajet", "maternite", "paternite"]), du: date, au: date }),
]);

/**
 * Décision sur un arrêt déclaré (encadrement du service, paie) : valider,
 * refuser avec un motif, ou corriger le type et les dates. Le salarié est
 * notifié de la décision. Jamais sur son propre arrêt (sauf direction
 * seule, tracée « auto-validée ») ; rang strictement supérieur (lib/hierarchie).
 * Les montants d'IJSS restent saisis par la paie, sur le bulletin.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: [...ENCADREMENT, "comptable"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide (motif de refus : 3 caractères au moins)." }, { status: 400 });
  const corps = parsed.data;

  const lecture = await lireArrets(supabase, { id });
  const arret = lecture.lignes[0];
  if (!arret) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
  if (!lecture.declarationActive) return NextResponse.json({ error: "Mise à jour de la base en attente : décision indisponible." }, { status: 503 });
  // Hiérarchie : jamais son propre arrêt (sauf direction seule), rang supérieur ; la paie garde ses droits.
  const garde = await garderDecision(supabase, appUser, arret.userId, { paie: true });
  if (!garde.ok) return garde.reponse;

  const maintenant = new Date().toISOString();
  let maj: Record<string, unknown>;
  if (corps.action === "valider") {
    maj = { status: "valide", validated_by: appUser.id, validated_at: maintenant, refusal_reason: null };
  } else if (corps.action === "refuser") {
    maj = { status: "refuse", validated_by: appUser.id, validated_at: maintenant, refusal_reason: corps.motif };
  } else {
    const autres = await lireArrets(supabase, { userId: arret.userId });
    const verif = verifierDeclaration(
      { type: corps.type, du: corps.du, au: corps.au },
      autres.lignes.filter((l) => l.id !== arret.id).map((l) => ({ id: l.id, type: l.type, du: l.du, au: l.au, statut: l.statut })),
      parisDay(),
    );
    if (!verif.ok) return NextResponse.json({ error: verif.erreur }, { status: 422 });
    maj = { stoppage_type: corps.type, start_date: corps.du, end_date: corps.au };
  }

  const { data, error } = await supabase
    .from("work_stoppages")
    .update({ ...maj, updated_at: maintenant })
    .eq("id", id)
    .select("id, start_date, end_date, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.code === "42501" ? error.message : "Enregistrement impossible." }, { status: error.code === "42501" ? 403 : 500 });
  if (!data) return NextResponse.json({ error: "Cet arrêt n'est pas dans votre périmètre." }, { status: 403 });

  if (corps.action !== "modifier") {
    await notifierArret(createAdminSupabaseClient(), {
      organizationId: appUser.organization_id,
      arretId: id,
      recipientUserId: arret.userId,
      severity: corps.action === "refuser" ? "warning" : "info",
      message: messageDecisionSalarie({ du: String(data.start_date), au: String(data.end_date), statut: corps.action === "valider" ? "valide" : "refuse", motif: corps.action === "refuser" ? corps.motif : null }),
    });
  }

  if (garde.autoValidee) await tracerAutoValidation(appUser, { table: "work_stoppages", id, decision: corps.action });
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "arret_decision",
    targetTable: "work_stoppages",
    targetId: id,
    details: { salarie: arret.userId, action: corps.action, par: appUser.role },
  });
  return NextResponse.json({ ok: true, statut: data.status });
}
