import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { journaliser } from "@/lib/audit/journal";
import { messageAmendeAttribuee, messageAmendeStatut } from "@/lib/rattachement/notifications";
import { notifier, peutDesignerChauffeur, rechercherResponsableAmende } from "@/lib/rattachement/serveur";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";

const bodySchema = z.object({
  /** Recalcule le rapprochement avec le planning (« Relancer la recherche »). */
  action: z.enum(["valider", "resuggerer"]).optional(),
  /** Responsable choisi (suggestion ou choix manuel) pour « valider ». */
  driver_id: z.string().uuid().optional(),
  planning_entry_id: z.string().uuid().nullable().optional(),
  // Historique : confirme la suggestion (= valider sans choix manuel).
  confirm: z.boolean().optional(),
  status: z.enum(["contested", "paid", "dismissed"]).optional(),
  // Historique : renvoie la notification au chauffeur désigné.
  notify: z.boolean().optional(),
});

const COLONNES = "id, organization_id, vehicle_id, driver_id, matched_planning_entry_id, amount, infraction_at, reference, status, vehicles(registration)";
const COLONNES_NOUVELLES = ", suggested_driver_id, reduced_amount, payment_deadline, location, run_id";

type Amende = {
  id: string;
  organization_id: string;
  vehicle_id: string;
  driver_id: string | null;
  matched_planning_entry_id: string | null;
  amount: number;
  infraction_at: string;
  reference: string | null;
  status: string;
  vehicles: { registration: string } | null;
  suggested_driver_id?: string | null;
  reduced_amount?: number | null;
  payment_deadline?: string | null;
  location?: string | null;
  run_id?: string | null;
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ["direction", "manager", "chauffeur"], modules: ["fines"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const decision = Boolean(body.action || body.confirm || body.notify);

  // Contestation par le chauffeur de sa propre amende (un manager qui
  // conduit peut aussi contester la sienne) ; sinon, gestion par l'encadrement.
  let contestationPersonnelle = appUser.role === "chauffeur";
  if (appUser.role === "manager" && appUser.conduit && body.status === "contested" && !decision) {
    const { data: sienne } = await createAdminSupabaseClient()
      .from("fines")
      .select("id")
      .eq("id", id)
      .eq("organization_id", appUser.organization_id)
      .eq("driver_id", appUser.id)
      .maybeSingle();
    contestationPersonnelle = Boolean(sienne);
  }
  if (contestationPersonnelle) {
    if (body.status !== "contested" || decision) {
      return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });
    }
    const admin = createAdminSupabaseClient();
    const { data: ownFine } = await admin.from("fines")
      .select("id, organization_id, driver_id, status, reference, infraction_at, vehicles(registration, service_id)")
      .eq("id", id).eq("organization_id", appUser.organization_id).eq("driver_id", appUser.id).maybeSingle();
    if (!ownFine) return NextResponse.json({ error: "Amende introuvable." }, { status: 404 });
    if (ownFine.status !== "identified") return NextResponse.json({ error: "Cette amende ne peut plus être contestée depuis cet écran." }, { status: 409 });
    const { error: updateError } = await admin.from("fines").update({ status: "contested" }).eq("id", id).eq("driver_id", appUser.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    const vehicule = ownFine.vehicles as unknown as { registration: string; service_id: string | null } | null;
    const alertError = await notifier(admin, {
      organizationId: appUser.organization_id,
      type: "fine_notification",
      severity: "info",
      message: `${appUser.full_name} signale une contestation pour une amende${ownFine.reference ? ` (réf. ${ownFine.reference})` : ""}${vehicule ? ` — véhicule ${vehicule.registration}` : ""}.`,
      relatedTable: "fines",
      relatedId: id,
      recipientRoles: ["manager", "direction"],
      serviceId: vehicule?.service_id ?? null,
    });
    if (alertError) return NextResponse.json({ error: alertError }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Encadrement : la RLS limite les managers aux véhicules de leur service
  // (lecture ci-dessous : amende hors service = introuvable).
  let lecture = await supabase.from("fines").select(COLONNES + COLONNES_NOUVELLES).eq("id", id).maybeSingle();
  const migree = !(lecture.error && estSchemaManquant(lecture.error));
  if (!migree) lecture = await supabase.from("fines").select(COLONNES).eq("id", id).maybeSingle();
  const fine = lecture.data as unknown as Amende | null;
  if (!fine) return NextResponse.json({ error: "Amende introuvable." }, { status: 404 });
  const admin = createAdminSupabaseClient();
  const immatriculation = fine.vehicles?.registration ?? null;
  const now = new Date().toISOString();

  if (body.action === "resuggerer") {
    const r = await rechercherResponsableAmende(supabase, appUser.organization_id, { vehicleId: fine.vehicle_id, infractionAt: fine.infraction_at });
    const s = r.suggestion;
    const base = { matched_planning_entry_id: s?.planningEntryId ?? null };
    let maj = await supabase
      .from("fines")
      .update(migree ? { ...base, suggested_driver_id: s?.driverId ?? null, run_id: s?.runId ?? null, match_confidence: r.confiance, match_details: r.details, matched_at: now } : base)
      .eq("id", id);
    if (maj.error && estSchemaManquant(maj.error)) maj = await supabase.from("fines").update(base).eq("id", id);
    if (maj.error) return NextResponse.json({ error: maj.error.message }, { status: 500 });
    return NextResponse.json({ confiance: r.confiance, raison: r.details.raison, suggestion: s ? { driverId: s.driverId, name: s.driverName, tourNumber: s.tourNumber } : null, candidats: r.details.candidats.length });
  }

  if (body.action === "valider" || body.confirm) {
    // Responsable : choix explicite, sinon la suggestion enregistrée.
    let driverId = body.driver_id ?? fine.suggested_driver_id ?? null;
    let planningEntryId = body.planning_entry_id !== undefined ? body.planning_entry_id : fine.matched_planning_entry_id;
    if (!driverId && fine.matched_planning_entry_id) {
      const { data: entry } = await supabase.from("planning_entries").select("driver_id").eq("id", fine.matched_planning_entry_id).maybeSingle();
      driverId = (entry as { driver_id?: string | null } | null)?.driver_id ?? null;
    }
    if (!driverId) return NextResponse.json({ error: "Choisissez le chauffeur responsable." }, { status: 422 });
    const { data: chauffeur } = await supabase.from("users").select("id, full_name").eq("id", driverId).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!chauffeur) return NextResponse.json({ error: "Chauffeur introuvable." }, { status: 404 });
    if (!(await peutDesignerChauffeur(supabase, appUser, driverId))) return NextResponse.json({ error: "Ce chauffeur n'appartient pas à vos services." }, { status: 403 });
    // Créneau choisi : doit être celui du chauffeur désigné, sinon il n'est pas gardé.
    if (planningEntryId) {
      const { data: entry } = await supabase.from("planning_entries").select("driver_id").eq("id", planningEntryId).maybeSingle();
      if ((entry as { driver_id?: string | null } | null)?.driver_id !== driverId) planningEntryId = null;
    }

    const base = { driver_id: driverId, status: "identified", notified_at: now, ...(planningEntryId ? { matched_planning_entry_id: planningEntryId } : {}) };
    let maj = await supabase
      .from("fines")
      .update(migree ? { ...base, planning_entry_id: planningEntryId ?? null, validated_by: appUser.id, validated_at: now } : base)
      .eq("id", id);
    if (maj.error && estSchemaManquant(maj.error)) maj = await supabase.from("fines").update(base).eq("id", id);
    if (maj.error) return NextResponse.json({ error: maj.error.message }, { status: 500 });

    const message = messageAmendeAttribuee({
      infractionAt: fine.infraction_at,
      immatriculation,
      montant: Number(fine.amount),
      montantMinore: fine.reduced_amount !== null && fine.reduced_amount !== undefined ? Number(fine.reduced_amount) : null,
      dateLimite: fine.payment_deadline ?? null,
      reference: fine.reference,
      lieu: fine.location ?? null,
    });
    const alertError = await notifier(admin, { organizationId: appUser.organization_id, type: "fine_notification", severity: "warning", message, relatedTable: "fines", relatedId: id, recipientUserId: driverId });
    if (alertError) return NextResponse.json({ error: alertError }, { status: 500 });
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "amende_responsable_valide",
      targetTable: "fines",
      targetId: id,
      details: { chauffeur: chauffeur.full_name, chauffeur_id: driverId, suggere: fine.suggested_driver_id ?? null, choix_manuel: Boolean(body.driver_id && body.driver_id !== fine.suggested_driver_id), planning_entry_id: planningEntryId ?? null, montant: Number(fine.amount), vehicule: immatriculation },
    });
    fine.driver_id = driverId;
  }

  if (body.status) {
    const { error } = await supabase.from("fines").update({ status: body.status }).eq("id", id);
    if (error && estValeurEnumInconnue(error)) return NextResponse.json({ error: "Statut « classée » indisponible : migration 20261026000003 à appliquer." }, { status: 409 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (fine.driver_id) {
      await notifier(admin, {
        organizationId: appUser.organization_id,
        type: "fine_notification",
        severity: "info",
        message: messageAmendeStatut({ infractionAt: fine.infraction_at, immatriculation }, body.status),
        relatedTable: "fines",
        relatedId: id,
        recipientUserId: fine.driver_id,
      });
    }
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "amende_statut_modifie", targetTable: "fines", targetId: id, details: { avant: fine.status, apres: body.status, vehicule: immatriculation } });
  }

  if (body.notify && !body.action && !body.confirm) {
    if (!fine.driver_id) {
      return NextResponse.json({ error: "Validez d'abord le chauffeur responsable." }, { status: 422 });
    }
    const message = messageAmendeAttribuee({ infractionAt: fine.infraction_at, immatriculation, montant: Number(fine.amount), montantMinore: fine.reduced_amount ?? null, dateLimite: fine.payment_deadline ?? null, reference: fine.reference });
    const alertError = await notifier(admin, { organizationId: appUser.organization_id, type: "fine_notification", severity: "warning", message, relatedTable: "fines", relatedId: id, recipientUserId: fine.driver_id });
    if (alertError) return NextResponse.json({ error: alertError }, { status: 500 });
    await supabase.from("fines").update({ notified_at: now }).eq("id", id);
  }

  return NextResponse.json({ ok: true });
}
