import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const bodySchema = z.object({ note: z.string().trim().max(300).optional() });

/**
 * A driver asks the exploitation for a document of this vehicle that
 * isn't marked consultable (or is missing). Raises an alert for the
 * vehicle's service managers — inserted with the service role, since
 * alerts are otherwise only written by database triggers.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Message trop long (300 caractères max)." }, { status: 400 });

  // RLS read: proves the vehicle belongs to the caller's organization.
  const supabase = await createServerSupabaseClient();
  const { data: vehicle } = await supabase.from("vehicles").select("id, registration, service_id").eq("id", id).maybeSingle();
  if (!vehicle) return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });

  const note = parsed.data.note ? ` — « ${parsed.data.note} »` : "";
  const { error } = await createAdminSupabaseClient()
    .from("alerts")
    .insert({
      organization_id: appUser.organization_id,
      service_id: vehicle.service_id,
      type: "vehicle_document_request",
      severity: "info",
      message: `${appUser.full_name} demande des papiers du véhicule ${vehicle.registration}${note}`,
      related_table: "vehicles",
      related_id: vehicle.id,
      recipient_roles: ["manager", "exploitation", "direction"],
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
