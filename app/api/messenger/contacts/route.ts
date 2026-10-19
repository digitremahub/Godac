import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

/** Colleague picker for the floating widget's "+" button. */
export async function GET() {
  const g = await garderApi({ modules: ["messenger"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();

  const messengerEnabled = await isModuleEnabled(supabase, appUser.organization_id, "messenger");
  if (!messengerEnabled) return NextResponse.json({ contacts: [] });

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("organization_id", appUser.organization_id)
    .eq("active", true)
    .neq("id", appUser.id)
    .order("full_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ contacts: data ?? [] });
}
