import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Adresse du siège de l'entreprise (retour de fin de tournée) ; null si non renseignée. */
export async function GET() {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("organizations").select("legal_address").eq("id", g.appUser.organization_id).maybeSingle();
  const adresse = typeof data?.legal_address === "string" ? data.legal_address.trim() : "";
  return NextResponse.json({ adresse: adresse || null });
}
