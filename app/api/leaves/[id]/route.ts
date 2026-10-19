import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z
  .object({
    status: z.enum(["approved", "rejected"]).optional(),
    start_date: z.string().date().optional(),
    end_date: z.string().date().optional(),
    reason: z.string().nullable().optional(),
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
    .select("driver_id, status")
    .eq("id", id)
    .single();
  if (fetchError || !current) {
    return NextResponse.json({ error: "Demande de congé introuvable" }, { status: 404 });
  }

  const isDecisionMaker = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);
  const isOwner = current.driver_id === appUser.id;

  const update: Record<string, unknown> = {};

  if (parsed.data.status) {
    if (!isDecisionMaker) {
      return NextResponse.json({ error: "Rôle non autorisé pour décider d'une demande de congé" }, { status: 403 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leaveRequest: data });
}
