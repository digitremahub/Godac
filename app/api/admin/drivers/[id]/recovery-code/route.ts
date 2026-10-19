import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createRecoveryCode, hashRecoveryCode } from "@/lib/auth/driver-recovery";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut générer un code de secours." }, { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminSupabaseClient();
  const { data: driver, error: lookupError } = await admin
    .from("users")
    .select("id, organization_id, auth_method, active, pending_approval")
    .eq("id", id)
    .maybeSingle();

  if (lookupError || !driver) {
    return NextResponse.json({ error: "Chauffeur introuvable." }, { status: 404 });
  }
  if (driver.organization_id !== appUser.organization_id) {
    return NextResponse.json({ error: "Ce chauffeur n'appartient pas à votre organisation." }, { status: 403 });
  }
  if (driver.auth_method !== "pin") {
    return NextResponse.json({ error: "Ce compte n'utilise pas l'authentification par badge/PIN." }, { status: 400 });
  }
  if (!driver.active || driver.pending_approval) {
    return NextResponse.json({ error: "Ce compte est désactivé ou en attente de validation." }, { status: 403 });
  }

  const recoveryCode = createRecoveryCode();
  const { error } = await admin
    .from("users")
    .update({ driver_recovery_code_hash: hashRecoveryCode(id, recoveryCode) })
    .eq("id", id)
    .eq("organization_id", appUser.organization_id);

  if (error) {
    return NextResponse.json({ error: "Impossible d'enregistrer le nouveau code de secours." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recoveryCode });
}
