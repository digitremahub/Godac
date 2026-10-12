"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import type { ScanEntityType } from "@/lib/qr/scan-targets";
import { buildScanUrl } from "@/lib/qr/scan-targets";

const TYPE_LABELS: Record<ScanEntityType, string> = {
  vehicle: "Véhicule",
  tank: "Cuve / Pompe",
  driver: "Chauffeur",
};

/**
 * Printable QR badge for a vehicle, tank/pump, or driver (Module 2/3
 * quick-identification). Designed to be screenshotted or printed
 * directly from the browser (`window.print()` on the vehicle/tank/
 * profile page) and stuck on the dashboard, the pump, or a badge.
 */
export function QrCodeBadge({
  type,
  id,
  title,
  subtitle,
  code,
}: {
  type: ScanEntityType;
  id: string;
  title: string;
  subtitle?: string;
  /** Driver's fallback code (lib/auth/session) — read aloud or typed in at a shared pump when the badge isn't on hand. */
  code?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, buildScanUrl(type, id), {
      width: 220,
      margin: 1,
      color: { dark: "#0A0F1E", light: "#FFFFFF" },
    }).catch((err) => console.error("QR render failed", err));
  }, [type, id]);

  return (
    <div className="flex w-56 flex-col items-center gap-2 rounded-2xl bg-white p-4 text-navy print:shadow-none">
      <canvas ref={canvasRef} role="img" aria-label={`QR code — ${title}`} />
      <p className="text-center font-display text-sm font-bold">{title}</p>
      {subtitle && <p className="text-center text-xs text-navy/70">{subtitle}</p>}
      {code && (
        <p className="text-center text-xs text-navy/65">
          Code de secours : <span className="font-mono font-semibold tracking-widest text-navy">{code}</span>
        </p>
      )}
      <span className="badge-neutral !bg-navy/10 !text-navy">{TYPE_LABELS[type]} · GODAC</span>
    </div>
  );
}
