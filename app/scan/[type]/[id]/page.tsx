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
 * badge is the odd one out since Lot 7: for most drivers it behaves
 * like before (identify yourself at a shared terminal, straight into
 * the fuel wizard — middleware.ts gates it behind sign-in same as
 * ever), but for a `pin`-auth driver scanned while signed out, this
 * badge *is* how they log in — middleware.ts lets `/scan/driver/*`
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

    redirect(`/fuel/new?driver=${id}`);
  }

  if (entityType === "vehicle") {
    redirect(`/v/${id}`);
  }
  redirect(`/fuel/new?${entityType}=${id}`);
}
