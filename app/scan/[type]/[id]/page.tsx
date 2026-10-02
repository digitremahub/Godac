import { redirect } from "next/navigation";
import type { ScanEntityType } from "@/lib/qr/scan-targets";

/**
 * Landing point for a QR sticker scanned by the phone's native camera
 * app (as opposed to the in-app scanner in components/fuel/QrScanner
 * used for the second/third scan in the same session). middleware.ts
 * already sends a signed-out visitor through /sign-in and back here
 * afterwards, so by the time this renders a session always exists.
 *
 * A vehicle sticker lands on its own quick-actions page (/v/[id]) —
 * tank and driver badges still go straight into the fuel-entry wizard,
 * which is the only flow that actually uses them.
 */
export default async function ScanRedirectPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  const entityType = (type as ScanEntityType) ?? "vehicle";

  if (entityType === "vehicle") {
    redirect(`/v/${id}`);
  }
  redirect(`/fuel/new?${entityType}=${id}`);
}
