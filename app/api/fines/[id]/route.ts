import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
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
  const g = await garderApi({ roles: ["direction", "manager", "manager_chauffeur", "chauffeur"], modules: ["fines"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Contestation par le chauffeur de sa propre amende (un manager-chauffeur
  // peut aussi contester la sienne) ; sinon, gestion par l'encadrement.
  let contestationPersonnelle = appUser.role === "chauffeur";
  if (appUser.role === "manager_chauffeur" && parsed.data.status === "contested" && !parsed.data.confirm && !parsed.data.notify) {
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
    if (parsed.data.status !== "contested" || parsed.data.confirm || parsed.data.notify) {
      return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });
    }
    const admin = createAdminSupabaseClient();
    const { data: ownFine } = await admin.from("fines")
      .select("id, organization_id, driver_id, status, reference, infraction_at")
      .eq("id", id).eq("organization_id", appUser.organization_id).eq("driver_id", appUser.id).maybeSingle();
    if (!ownFine) return NextResponse.json({ error: "Amende introuvable." }, { status: 404 });
    if (ownFine.status !== "identified") return NextResponse.json({ error: "Cette amende ne peut plus être contestée depuis cet écran." }, { status: 409 });
    const { error: updateError } = await admin.from("fines").update({ status: "contested" }).eq("id", id).eq("driver_id", appUser.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    const { error: alertError } = await admin.from("alerts").insert({
      organization_id: appUser.organization_id,
      type: "fine_notification",
      severity: "info",
      message: `${appUser.full_name} signale une contestation pour une amende${ownFine.reference ? ` (réf. ${ownFine.reference})` : ""}.`,
      related_table: "fines",
      related_id: id,
      recipient_roles: ["direction"],
    });
    if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  // Encadrement : la RLS limite les managers aux véhicules de leur service
  // (lecture ci-dessous : amende hors service = introuvable).

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
    const date = new Date(fine.infraction_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
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
