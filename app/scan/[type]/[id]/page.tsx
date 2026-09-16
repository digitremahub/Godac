import { redirect } from "next/navigation";
import type { ScanEntityType } from "@/lib/qr/scan-targets";

const PARAM_BY_TYPE: Record<ScanEntityType, string> = {
  vehicle: "vehicle",
  tank: "tank",
  driver: "driver",
};

/**
 * Landing point for a QR sticker scanned by the phone's native camera
 * app (as opposed to the in-app scanner in components/fuel/QrScanner
 * used for the second/third scan in the same session). middleware.ts
 * already sends a signed-out visitor through /sign-in and back here
 * afterwards, so by the time this renders a session always exists.
 */
export default async function ScanRedirectPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  redirect(`/fuel/new?${PARAM_BY_TYPE[type as ScanEntityType] ?? "vehicle"}=${id}`);
}
