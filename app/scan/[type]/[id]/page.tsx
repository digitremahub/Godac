import { redirect } from "next/navigation";
import type { ScanEntityType } from "@/lib/qr/scan-targets";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Landing point for a QR sticker scanned by the phone's native camera
 * app (as opposed to the in-app scanner in components/fuel/QrScanner
 * used for the second/third scan in the same session).
 *
 * A vehicle sticker lands on its own quick-actions page (/v/[id]) —
 * tank badges still go straight into the fuel-entry wizard. A driver
 * badge has three distinct destinations: scanning *your own* badge
 * while signed in opens your profile (/account, where that same badge
 * is displayed — this is "show me my badge again", not an
 * identification scan); scanning *someone else's* driver badge (a
 * shared terminal at the pump) goes to the fuel wizard with them
 * pre-filled, same as before; scanned signed-out, it's how a
 * `pin`-auth driver logs in — middleware.ts lets `/scan/driver/*`
 * through unauthenticated specifically so this check can run.
 */
export default async function ScanRedirectPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  const entityType = (type as ScanEntityType) ?? "vehicle";

  if (entityType === "driver") {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const admin = createAdminSupabaseClient();
      const { data: driver } = await admin.from("users").select("auth_method").eq("id", id).maybeSingle();
      if (driver?.auth_method === "pin") {
        redirect(`/driver-pin/${id}`);
      }
      redirect(`/sign-in?redirect_to=${encodeURIComponent(`/scan/driver/${id}`)}`);
    }

    if (user.id === id) {
      redirect("/account");
    }
    redirect(`/fuel/new?driver=${id}`);
  }

  if (entityType === "vehicle") {
    redirect(`/v/${id}`);
  }
  redirect(`/fuel/new?${entityType}=${id}`);
}
