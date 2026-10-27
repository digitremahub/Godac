import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { garderDecision, tracerAutoValidation } from "@/lib/hierarchie/serveur";
import { journaliser } from "@/lib/audit/journal";
import { controlerApprobation } from "@/lib/leaves/controle";
import { affectationsDuConge, signalerAbsenceSemaineGeneree, signalerAffectationsConge } from "@/lib/leaves/planning-serveur";
import { soldesConges } from "@/lib/paie/conges-serveur";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parisDay } from "@/lib/utils/paris-time";

const bodySchema = z
  .object({
    status: z.enum(["approved", "rejected"]).optional(),
    start_date: z.string().date().optional(),
    end_date: z.string().date().optional(),
    reason: z.string().nullable().optional(),
    /** Approbation confirmée malgré un solde insuffisant. */
    confirmerSoldeInsuffisant: z.boolean().optional(),
  })
  .refine((b) => !(b.start_date && b.end_date) || b.end_date >= b.start_date, {
    message: "La date de fin doit être après la date de début",
    path: ["end_date"],
  });

/**
 * Two distinct write paths on the same request, per the
 * "modifier" (edit) ask on top of the original approve/reject:
 *  - the requesting driver can edit their own dates/reason, but only
 *    while it's still "pending" (a decided request is history);
 *  - a manager-like/direction user can decide (status) or edit any
 *    field within their own service — RLS ("leave: manager-like
 *    decides within service") is the real scope check, this route
 *    just gives a clearer error and applies decided_by/decided_at.
 *
 * Décision : jamais sa propre demande (garderDecision, direction seule tracée),
 * solde contrôlé côté serveur (confirmation explicite si insuffisant, lib/leaves/controle.ts),
 * décision tracée au journal d'audit, et l'approbation signale à l'encadrement les
 * affectations déjà posées sur ces jours (libérables via /api/leaves/[id]/liberer).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["leave_management"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: current, error: fetchError } = await supabase
    .from("leave_requests")
    .select("driver_id, status, start_date, end_date")
    .eq("id", id)
    .single();
  if (fetchError || !current) {
    return NextResponse.json({ error: "Demande de congé introuvable" }, { status: 404 });
  }

  const isDecisionMaker = hasRole(appUser.role, ["manager", "exploitation", "direction"]);
  const isOwner = current.driver_id === appUser.id;

  const update: Record<string, unknown> = {};
  let autoValidee = false;

  if (parsed.data.status) {
    if (!isDecisionMaker) {
      return NextResponse.json({ error: "Rôle non autorisé pour décider d'une demande de congé" }, { status: 403 });
    }
    // Hiérarchie : jamais sa propre demande, rang strictement supérieur (lib/hierarchie).
    const garde = await garderDecision(supabase, appUser, current.driver_id);
    if (!garde.ok) return garde.reponse;
    autoValidee = garde.autoValidee;
    if (parsed.data.status === "approved") {
      // Période décidée : celle de la demande, ou celle que le décideur corrige dans le même appel.
      const du = parsed.data.start_date ?? current.start_date;
      const au = parsed.data.end_date ?? current.end_date;
      const [{ data: existants }, soldes] = await Promise.all([
        supabase.from("leave_requests").select("id, start_date, end_date, status").eq("driver_id", current.driver_id).in("status", ["pending", "approved"]).lte("start_date", au).gte("end_date", du),
        soldesConges(supabase, appUser.organization_id, [current.driver_id], parisDay()),
      ]);
      const verdict = controlerApprobation({
        idDemande: id,
        du,
        au,
        existants: ((existants ?? []) as { id: string; start_date: string; end_date: string; status: string }[]).map((c) => ({ id: c.id, du: c.start_date, au: c.end_date, status: c.status })),
        solde: current.status === "pending" ? (soldes.get(current.driver_id) ?? null) : null,
        confirmerSoldeInsuffisant: Boolean(parsed.data.confirmerSoldeInsuffisant),
      });
      if (!verdict.ok) return NextResponse.json({ error: verdict.erreur, code: verdict.code }, { status: verdict.status });
    }
    update.status = parsed.data.status;
    update.decided_by = appUser.id;
    update.decided_at = new Date().toISOString();
  }

  const editsDates = parsed.data.start_date !== undefined || parsed.data.end_date !== undefined || parsed.data.reason !== undefined;
  if (editsDates) {
    if (!isDecisionMaker && !(isOwner && current.status === "pending")) {
      return NextResponse.json(
        { error: "Vous ne pouvez modifier qu'une de vos demandes encore en attente" },
        { status: 403 },
      );
    }
    // Corriger la demande d'un autre est une décision : même hiérarchie. Sa propre demande en attente reste modifiable par son auteur.
    if (isDecisionMaker && !(isOwner && current.status === "pending") && !parsed.data.status) {
      const garde = await garderDecision(supabase, appUser, current.driver_id);
      if (!garde.ok) return garde.reponse;
    }
    if (parsed.data.start_date !== undefined) update.start_date = parsed.data.start_date;
    if (parsed.data.end_date !== undefined) update.end_date = parsed.data.end_date;
    if (parsed.data.reason !== undefined) update.reason = parsed.data.reason || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("leave_requests")
    .update(update)
    .eq("id", id)
    .select("id, status, start_date, end_date, reason")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  if (autoValidee) await tracerAutoValidation(appUser, { table: "leave_requests", id, decision: String(parsed.data.status) });

  // Décision : trace d'audit, et signalement des affectations du planning touchées par un congé approuvé.
  let affectationsTouchees = 0;
  if (parsed.data.status) {
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "conge_decision",
      targetTable: "leave_requests",
      targetId: id,
      details: { salarie: current.driver_id, decision: parsed.data.status, du: data.start_date, au: data.end_date, avant: current.status, auto: autoValidee, soldeConfirme: Boolean(parsed.data.confirmerSoldeInsuffisant) },
    });
    if (parsed.data.status === "approved") {
      const touchees = await affectationsDuConge(supabase, appUser.organization_id, current.driver_id, data.start_date, data.end_date);
      affectationsTouchees = touchees.length;
      if (touchees.length > 0) {
        const { data: salarie } = await supabase.from("users").select("full_name").eq("id", current.driver_id).maybeSingle();
        await signalerAffectationsConge(createAdminSupabaseClient(), {
          organizationId: appUser.organization_id,
          driverId: current.driver_id,
          nom: salarie?.full_name ?? "Le salarié",
          du: data.start_date,
          au: data.end_date,
          affectationIds: touchees.map((t) => t.id),
        });
        // Semaine suivante générée automatiquement et pas encore confirmée : l'encadrement qui la voit est prévenu aussi.
        await signalerAbsenceSemaineGeneree(createAdminSupabaseClient(), {
          organizationId: appUser.organization_id,
          driverId: current.driver_id,
          nom: salarie?.full_name ?? "Le salarié",
          du: data.start_date,
          au: data.end_date,
          affectations: touchees,
        });
      }
    }
  }
  return NextResponse.json({ leaveRequest: data, affectationsTouchees });
}
