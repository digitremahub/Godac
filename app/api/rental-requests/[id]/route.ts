import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { nextStatusAfterManager, type RentalRequestStatus } from "@/lib/rental/workflow";
import { addRentalEvent, transmitRentalRequest } from "@/lib/rental/server";

const bodySchema = z.object({
  action: z.enum(["valider", "refuser", "transmettre", "terminer"]),
  comment: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Décision du responsable sur une demande au loueur :
 *  - valider     → « validée », puis transmission immédiate au
 *                  prestataire (e-mail + lien sécurisé) → « transmise » ;
 *  - transmettre → renvoi d'un nouveau lien (l'ancien est révoqué) ;
 *  - refuser     → « refusée » (motif conservé) ;
 *  - terminer    → clôture manuelle si le prestataire n'a pas répondu.
 * Qui / quand est tracé sur la demande et dans rental_request_events.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["rental_providers"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "direction"])) {
    return NextResponse.json({ error: "Réservé aux responsables et à la direction." }, { status: 403 });
  }
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "rental_providers"))) {
    return NextResponse.json({ error: "Module Véhicules loués non activé." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  const { action, comment } = parsed.data;

  const { data: request } = await supabase
    .from("rental_maintenance_requests")
    .select("id, organization_id, status, intervention_id")
    .eq("id", id)
    .maybeSingle();
  if (!request) return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  const status = request.status as RentalRequestStatus;
  const now = new Date().toISOString();

  if (action === "transmettre") {
    if (!nextStatusAfterManager(status, "transmettre")) {
      return NextResponse.json({ error: "Cette demande doit d'abord être validée." }, { status: 409 });
    }
    const result = await transmitRentalRequest(supabase, appUser, id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    return NextResponse.json(result);
  }

  const next = nextStatusAfterManager(status, action);
  if (!next) return NextResponse.json({ error: "Action impossible dans le statut actuel de la demande." }, { status: 409 });

  const patch: Record<string, unknown> = { status: next, updated_at: now };
  if (action === "valider") Object.assign(patch, { validated_by: appUser.id, validated_at: now });
  if (action === "refuser") Object.assign(patch, { refused_by: appUser.id, refused_at: now, refusal_reason: comment || null });
  if (action === "terminer") Object.assign(patch, { completed_at: now });

  // Garde optimiste : la mise à jour ne passe que si le statut n'a pas
  // changé entre-temps (double clic, autre responsable, prestataire).
  const { data: updated, error } = await supabase
    .from("rental_maintenance_requests")
    .update(patch)
    .eq("id", id)
    .eq("status", status)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "La demande a été modifiée entre-temps, rechargez la page." }, { status: 409 });

  await addRentalEvent(supabase, {
    organization_id: request.organization_id,
    request_id: id,
    actor_kind: "utilisateur",
    actor_user_id: appUser.id,
    action,
    status_from: status,
    status_to: next,
    comment: comment || null,
  });

  if (action === "terminer") {
    await supabase.from("vehicle_interventions").update({ status: "done", completed_at: now }).eq("id", request.intervention_id);
  }

  if (action === "valider") {
    const result = await transmitRentalRequest(supabase, appUser, id);
    if ("error" in result) return NextResponse.json({ status: next, transmitError: result.error });
    return NextResponse.json(result);
  }
  return NextResponse.json({ status: next });
}
