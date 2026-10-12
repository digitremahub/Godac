import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** GODAC operator (FAQ curation…), independent of any organisation role — see platform_admins. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data } = await createAdminSupabaseClient().from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}
