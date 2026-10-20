import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { isRentedOwnership } from "@/lib/rental/workflow";
import { addRentalEvent } from "@/lib/rental/server";

const bodySchema = z.object({ intervention_id: z.string().uuid() });

/**
 * Ouvre une demande au loueur pour une intervention existante (créée
 * avant que le véhicule ne soit déclaré loué, ou avant l'activation du
 * module). Les nouvelles interventions sur un véhicule loué l'ouvrent
 * automatiquement (déclencheur SQL, migration 20260101000134).
 */
export async function POST(req: Request) {
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
  if (!parsed.success) return NextResponse.json({ error: "Intervention invalide." }, { status: 400 });

  const { data: intervention } = await supabase
    .from("vehicle_interventions")
    .select("id, organization_id, vehicle_id, status, vehicles(ownership, rental_provider_id)")
    .eq("id", parsed.data.intervention_id)
    .maybeSingle();
  const i = intervention as any;
  if (!i) return NextResponse.json({ error: "Intervention introuvable." }, { status: 404 });
  if (!isRentedOwnership(i.vehicles?.ownership) || !i.vehicles?.rental_provider_id) {
    return NextResponse.json({ error: "Ce véhicule n'est pas déclaré loué auprès d'un prestataire." }, { status: 400 });
  }
  if (i.status === "done" || i.status === "cancelled") {
    return NextResponse.json({ error: "Cette intervention est déjà terminée ou annulée." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("rental_maintenance_requests")
    .insert({ organization_id: appUser.organization_id, intervention_id: i.id, vehicle_id: i.vehicle_id, provider_id: i.vehicles.rental_provider_id })
    .select("id")
    .single();
  if (error) {
    const dup = error.code === "23505";
    return NextResponse.json({ error: dup ? "Une demande au loueur existe déjà pour cette intervention." : error.message }, { status: dup ? 409 : 500 });
  }
  await addRentalEvent(supabase, {
    organization_id: appUser.organization_id,
    request_id: data.id,
    actor_kind: "utilisateur",
    actor_user_id: appUser.id,
    action: "creation",
    status_to: "a_valider",
  });
  return NextResponse.json({ request: data });
}
