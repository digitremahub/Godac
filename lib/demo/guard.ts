import "server-only";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** True for the « Transports Démo » organization (organizations.is_demo). */
export async function isDemoOrganization(organizationId: string): Promise<boolean> {
  const { data } = await createAdminSupabaseClient().from("organizations").select("is_demo").eq("id", organizationId).maybeSingle();
  return Boolean(data?.is_demo);
}

/** 403 for actions with an outside effect (emails, invitations, billing) when called from the demo. */
export async function blockInDemo(organizationId: string): Promise<NextResponse | null> {
  if (!(await isDemoOrganization(organizationId))) return null;
  return NextResponse.json({ error: "Action désactivée dans la démo — créez votre espace GODAC pour l'utiliser." }, { status: 403 });
}
