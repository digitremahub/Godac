import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  // Turns the suggested match (fines.matched_planning_entry_id) into
  // the official driver_id — the one direction-only action this route
  // gates on, see findFineMatchCandidate.
  confirm: z.boolean().optional(),
  status: z.enum(["contested", "paid"]).optional(),
  // Sends the "alerts" notification to the now-confirmed driver;
  // separate from confirm so direction can confirm now and notify
  // later if they want to review first.
  notify: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: fine, error: fineError } = await supabase
    .from("fines")
    .select("id, organization_id, driver_id, matched_planning_entry_id, amount, infraction_at, reference, status")
    .eq("id", id)
    .single();
  if (fineError || !fine) return NextResponse.json({ error: "Amende introuvable." }, { status: 404 });

  if (parsed.data.confirm) {
    if (!fine.matched_planning_entry_id) {
      return NextResponse.json({ error: "Aucun chauffeur suggéré à confirmer pour cette amende." }, { status: 422 });
    }
    const { data: entry } = await supabase.from("planning_entries").select("driver_id").eq("id", fine.matched_planning_entry_id).single();
    if (!entry?.driver_id) return NextResponse.json({ error: "Le chauffeur suggéré est introuvable." }, { status: 422 });

    const { error: updateError } = await supabase
      .from("fines")
      .update({ driver_id: entry.driver_id, status: "identified" })
      .eq("id", id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    fine.driver_id = entry.driver_id;
  }

  if (parsed.data.status) {
    const { error: statusError } = await supabase.from("fines").update({ status: parsed.data.status }).eq("id", id);
    if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 });
  }

  if (parsed.data.notify) {
    if (!fine.driver_id) {
      return NextResponse.json({ error: "Confirmez d'abord le chauffeur avant de le notifier." }, { status: 422 });
    }
    const date = new Date(fine.infraction_at).toLocaleDateString("fr-FR");
    const message = `Une amende de ${fine.amount} € du ${date}${fine.reference ? ` (réf. ${fine.reference})` : ""} vous a été attribuée.`;
    // RLS has no insert policy for "alerts" on authenticated clients
    // (only security-definer triggers and service-role crons write to
    // it — see 20260101000030 and app/api/planning/validate) — same
    // admin-client escape hatch, role already checked above.
    const admin = createAdminSupabaseClient();
    const { error: alertError } = await admin.from("alerts").insert({
      organization_id: fine.organization_id,
      type: "fine_notification",
      severity: "warning",
      message,
      related_table: "fines",
      related_id: id,
      recipient_user_id: fine.driver_id,
    });
    if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 });

    const { error: notifiedError } = await supabase.from("fines").update({ notified_at: new Date().toISOString() }).eq("id", id);
    if (notifiedError) return NextResponse.json({ error: notifiedError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
