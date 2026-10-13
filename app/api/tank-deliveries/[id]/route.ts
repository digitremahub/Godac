import { NextResponse } from "next/server";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Annule une livraison saisie par erreur. Seule la dernière livraison
 * d'une cuve peut l'être : le trigger before_tank_delivery_delete
 * (migration 121) retire ses litres du stock et restaure exactement le
 * PMP d'avant. Une livraison plus ancienne se corrige en annulant les
 * suivantes, dans l'ordre.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour annuler un approvisionnement" }, { status: 403 });
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("tank_deliveries").delete().eq("id", id).select("id");
  if (error) {
    const message = error.message.includes("dernière livraison") ? "Seule la dernière livraison d'une cuve peut être annulée." : error.message;
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (!data?.length) return NextResponse.json({ error: "Livraison introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
