import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isModuleEnabled } from "@/lib/organization/modules";
import { suggererChauffeur } from "@/lib/contestations/rattachement";

const champs = z.object({
  client_name: z.string().trim().max(200).nullable(),
  reference: z.string().trim().max(100).nullable(),
  parcel_code: z.string().trim().max(100).nullable(),
  delivery_address: z.string().trim().max(300).nullable(),
  delivery_date: z.string().date().nullable(),
  tour_number: z.string().trim().max(60).nullable(),
  reason: z.string().trim().max(2000).nullable(),
  claimed_amount: z.coerce.number().min(0).max(1_000_000).nullable(),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enregistrer"), champs: champs.partial() }),
  z.object({ action: z.literal("resuggerer") }),
  z.object({ action: z.literal("valider"), driver_id: z.string().uuid(), champs: champs.partial().optional() }),
  z.object({ action: z.literal("repondre"), reponse: z.string().trim().min(3).max(4000) }),
  z.object({ action: z.literal("cloturer"), statut: z.enum(["resolved", "rejected"]), note: z.string().trim().max(2000).nullable() }),
]);

/**
 * Cycle d'une contestation : l'encadrement corrige les champs lus,
 * valide le chauffeur (→ notification), le chauffeur répond (→
 * notification à l'encadrement), l'encadrement clôture.
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
    await admin.from("alerts").insert({
      organization_id: c.organization_id,
      type: "customer_dispute",
      severity: "info",
      message: `${appUser.full_name} a répondu à la contestation${c.client_name ? ` de ${c.client_name}` : ""}.`,
      related_table: "customer_disputes",
      related_id: id,
      recipient_roles: ["manager", "direction"],
    });
    return NextResponse.json({ ok: true });
  }

  if (!hasRole(appUser.role, ["manager", "direction"])) return NextResponse.json({ error: "Réservé à l'encadrement." }, { status: 403 });
  const { data: c } = await supabase.from("customer_disputes").select("*").eq("id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "Contestation introuvable." }, { status: 404 });

  if (body.action === "enregistrer") {
    const { error } = await supabase.from("customer_disputes").update({ ...body.champs, updated_at: now }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "resuggerer") {
    const s = await suggererChauffeur(supabase, appUser.organization_id, c);
    await supabase.from("customer_disputes").update({ suggested_driver_id: s?.driverId ?? null, suggestion_reason: s?.raison ?? null, delivery_stop_id: s?.stopId ?? null, updated_at: now }).eq("id", id);
    return NextResponse.json({ suggestion: s });
  }

  if (body.action === "valider") {
    const { data: chauffeur } = await supabase.from("users").select("id, full_name").eq("id", body.driver_id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!chauffeur) return NextResponse.json({ error: "Chauffeur introuvable." }, { status: 404 });
    const fiche = { ...c, ...(body.champs ?? {}) };
    const { error } = await supabase
      .from("customer_disputes")
      .update({ ...(body.champs ?? {}), driver_id: chauffeur.id, status: "assigned", validated_by: appUser.id, validated_at: now, updated_at: now })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const date = fiche.delivery_date ? ` du ${new Date(`${fiche.delivery_date}T12:00:00Z`).toLocaleDateString("fr-FR")}` : "";
    // Insertion par le client service, comme les amendes : la RLS d'alerts
    // n'autorise pas l'insertion par un utilisateur.
    const { error: alertError } = await admin.from("alerts").insert({
      organization_id: appUser.organization_id,
      type: "customer_dispute",
      severity: "warning",
      message: `Contestation client à régler${fiche.client_name ? ` — ${fiche.client_name}` : ""}${date}${fiche.reason ? ` : ${fiche.reason}` : ""}`.slice(0, 480),
      related_table: "customer_disputes",
      related_id: id,
      recipient_user_id: chauffeur.id,
    });
    if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("customer_disputes")
    .update({ status: body.statut, resolution_note: body.note, resolved_at: now, updated_at: now })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (c.driver_id) {
    await admin.from("alerts").insert({
      organization_id: appUser.organization_id,
      type: "customer_dispute",
      severity: "info",
      message: `Contestation${c.client_name ? ` de ${c.client_name}` : ""} ${body.statut === "resolved" ? "réglée" : "classée sans suite"}.`,
      related_table: "customer_disputes",
      related_id: id,
      recipient_user_id: c.driver_id,
    });
  }
  return NextResponse.json({ ok: true });
}
