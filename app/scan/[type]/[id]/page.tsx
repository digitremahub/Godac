import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import type { ScanEntityType } from "@/lib/qr/scan-targets";

const PARAM_BY_TYPE: Record<ScanEntityType, string> = {
  vehicle: "vehicle",
  tank: "tank",
  driver: "driver",
};

/**
 * Landing point for a QR sticker scanned by the phone's native camera
 * app (as opposed to the in-app scanner in components/fuel/QrScanner
 * used for the second/third scan in the same session). Signed-out
 * users get sent through sign-in first, then land back here via
 * Clerk's redirect_url, and finally reach /fuel/new pre-filled with
 * whatever was scanned.
 */
export default async function ScanRedirectPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  const { userId } = await auth();

  const target = `/fuel/new?${PARAM_BY_TYPE[type as ScanEntityType] ?? "vehicle"}=${id}`;

  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
  }

  redirect(target);
}
