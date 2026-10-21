import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isModuleEnabled } from "@/lib/organization/modules";
import { journaliser } from "@/lib/audit/journal";
import { messageContestationAttribuee, messageContestationCloturee } from "@/lib/rattachement/notifications";
import { notifier, peutDesignerChauffeur, rechercherResponsableContestation, serviceDuChauffeur } from "@/lib/rattachement/serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const champs = z.object({
  client_name: z.string().trim().max(200).nullable(),
  reference: z.string().trim().max(100).nullable(),
  parcel_code: z.string().trim().max(100).nullable(),
  delivery_address: z.string().trim().max(300).nullable(),
  delivery_date: z.string().date().nullable(),
  tour_number: z.string().trim().max(60).nullable(),
  reason: z.string().trim().max(2000).nullable(),
  claimed_amount: z.coerce.number().min(0).max(1_000_000).nullable(),
  /** Destinataire du colis (colonne ajoutée par 20261026000003). */
  recipient: z.string().trim().max(200).nullable(),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enregistrer"), champs: champs.partial() }),
  z.object({ action: z.literal("resuggerer") }),
  z.object({ action: z.literal("valider"), driver_id: z.string().uuid(), stop_id: z.string().uuid().nullable().optional(), champs: champs.partial().optional() }),
  z.object({ action: z.literal("repondre"), reponse: z.string().trim().min(3).max(4000) }),
  z.object({ action: z.literal("cloturer"), statut: z.enum(["resolved", "rejected"]), note: z.string().trim().max(2000).nullable() }),
]);

/** Mise à jour tolérante : sans la migration 20261026000003, les colonnes nouvelles sont retirées. */
async function majTolerante(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, id: string, complet: Record<string, unknown>, nouvelles: string[]) {
  const r = await supabase.from("customer_disputes").update(complet).eq("id", id);
  if (!r.error || !estSchemaManquant(r.error)) return r;
  const base = Object.fromEntries(Object.entries(complet).filter(([k]) => !nouvelles.includes(k)));
  return supabase.from("customer_disputes").update(base).eq("id", id);
}
const NOUVELLES = ["recipient", "run_id", "planning_entry_id", "match_confidence", "match_details", "matched_at"];

/**
 * Cycle d'une contestation : l'encadrement corrige les champs lus,
 * relance la recherche de l'arrêt / du chauffeur, valide le responsable
 * (→ notification au chauffeur, journal d'audit), le chauffeur répond
 * (→ notification à l'encadrement), l'encadrement clôture (→ notification,
 * journal). Un manager ne désigne que les chauffeurs de ses services.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ modules: ["customer_disputes"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "customer_disputes"))) return NextResponse.json({ error: "Module Contestations clients non activé." }, { status: 403 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const body = parsed.data;
  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();

  if (body.action === "repondre") {
    // Le chauffeur n'a qu'un droit de lecture (RLS) : la réponse passe par
    // le client service après vérification qu'il est bien l'attributaire.
    const { data: c } = await admin.from("customer_disputes").select("id, organization_id, driver_id, status, client_name").eq("id", id).maybeSingle();
    if (!c || c.organization_id !== appUser.organization_id || c.driver_id !== appUser.id || !["assigned", "answered"].includes(c.status)) {
      return NextResponse.json({ error: "Contestation introuvable." }, { status: 404 });
    }
    const { error } = await admin.from("customer_disputes").update({ driver_response: body.reponse, responded_at: now, status: "answered", updated_at: now }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await notifier(admin, {
      organizationId: c.organization_id,
      type: "customer_dispute",
      severity: "info",
      message: `${appUser.full_name} a répondu à la contestation${c.client_name ? ` de ${c.client_name}` : ""}.`,
      relatedTable: "customer_disputes",
      relatedId: id,
      recipientRoles: ["manager", "exploitation", "direction"],
      serviceId: await serviceDuChauffeur(admin, appUser.id),
    });
    return NextResponse.json({ ok: true });
  }

  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) return NextResponse.json({ error: "Réservé à l'encadrement." }, { status: 403 });
  const { data: c } = await supabase.from("customer_disputes").select("*").eq("id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "Contestation introuvable." }, { status: 404 });

  if (body.action === "enregistrer") {
    const { error } = await majTolerante(supabase, id, { ...body.champs, updated_at: now }, NOUVELLES);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "resuggerer") {
    const r = await rechercherResponsableContestation(supabase, appUser.organization_id, {
      parcelCode: c.parcel_code ?? null,
      deliveryAddress: c.delivery_address ?? null,
      recipient: c.recipient ?? null,
      deliveryDate: c.delivery_date ?? null,
      tourNumber: c.tour_number ?? null,
    });
    const s = r.suggestion;
    const { error } = await majTolerante(
      supabase,
      id,
      {
        suggested_driver_id: s?.driverId ?? null,
        suggestion_reason: s?.raison ?? r.details.raison,
        delivery_stop_id: s?.stopId ?? null,
        run_id: s?.runId ?? null,
        planning_entry_id: s?.planningEntryId ?? null,
        match_confidence: r.confiance,
        match_details: r.details,
        matched_at: now,
        updated_at: now,
      },
      NOUVELLES,
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ confiance: r.confiance, raison: r.details.raison, suggestion: s ? { driverId: s.driverId, driverName: s.driverName, raison: s.raison } : null });
  }

  if (body.action === "valider") {
    const { data: chauffeur } = await supabase.from("users").select("id, full_name").eq("id", body.driver_id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!chauffeur) return NextResponse.json({ error: "Chauffeur introuvable." }, { status: 404 });
    if (!(await peutDesignerChauffeur(supabase, appUser, chauffeur.id))) return NextResponse.json({ error: "Ce chauffeur n'appartient pas à vos services." }, { status: 403 });
    const fiche = { ...c, ...(body.champs ?? {}) };

    // Arrêt choisi parmi les candidats : il doit appartenir à une tournée du chauffeur désigné.
    let stopId: string | null = body.stop_id === undefined ? (c.suggested_driver_id === chauffeur.id ? (c.delivery_stop_id ?? null) : null) : body.stop_id;
    let runId: string | null = null;
    let planningEntryId: string | null = c.suggested_driver_id === chauffeur.id ? (c.planning_entry_id ?? null) : null;
    let livreLe: string | null = null;
    if (stopId) {
      const { data: arret } = await supabase.from("delivery_stops").select("id, done_at, delivery_runs!inner(id, driver_id, planning_entry_id)").eq("id", stopId).maybeSingle();
      const run = (arret as { delivery_runs?: { id: string; driver_id: string; planning_entry_id: string | null } } | null)?.delivery_runs;
      if (!arret || !run || run.driver_id !== chauffeur.id) stopId = null;
      else {
        runId = run.id;
        planningEntryId = run.planning_entry_id ?? planningEntryId;
        livreLe = (arret as { done_at: string | null }).done_at;
      }
    }

    const { error } = await majTolerante(
      supabase,
      id,
      {
        ...(body.champs ?? {}),
        driver_id: chauffeur.id,
        delivery_stop_id: stopId,
        run_id: runId,
        planning_entry_id: planningEntryId,
        status: "assigned",
        validated_by: appUser.id,
        validated_at: now,
        updated_at: now,
      },
      NOUVELLES,
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Insertion par le client service, comme les amendes : la RLS d'alerts
    // n'autorise pas l'insertion par un utilisateur.
    const alertError = await notifier(admin, {
      organizationId: appUser.organization_id,
      type: "customer_dispute",
      severity: "warning",
      message: messageContestationAttribuee({ parcelCode: fiche.parcel_code ?? null, clientName: fiche.client_name ?? null, livreLe, deliveryDate: fiche.delivery_date ?? null, reason: fiche.reason ?? null }),
      relatedTable: "customer_disputes",
      relatedId: id,
      recipientUserId: chauffeur.id,
    });
    if (alertError) return NextResponse.json({ error: alertError }, { status: 500 });
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "contestation_responsable_valide",
      targetTable: "customer_disputes",
      targetId: id,
      details: { chauffeur: chauffeur.full_name, chauffeur_id: chauffeur.id, suggere: c.suggested_driver_id ?? null, choix_manuel: c.suggested_driver_id !== chauffeur.id, arret: stopId, colis: fiche.parcel_code ?? null },
    });
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("customer_disputes")
    .update({ status: body.statut, resolution_note: body.note, resolved_at: now, updated_at: now })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (c.driver_id) {
    await notifier(admin, {
      organizationId: appUser.organization_id,
      type: "customer_dispute",
      severity: "info",
      message: messageContestationCloturee({ parcelCode: c.parcel_code ?? null, clientName: c.client_name ?? null }, body.statut),
      relatedTable: "customer_disputes",
      relatedId: id,
      recipientUserId: c.driver_id,
    });
  }
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "contestation_cloturee", targetTable: "customer_disputes", targetId: id, details: { avant: c.status, apres: body.statut, note: body.note } });
  return NextResponse.json({ ok: true });
}
