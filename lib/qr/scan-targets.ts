/**
 * QR identification for the fuel-entry flow: a sticker on the truck's
 * dashboard (vehicle), one on each pump/cuve (tank), and a badge each
 * chauffeur can carry (driver) — scanning them pre-fills the "Nouveau
 * ravitaillement" form instead of hunting through dropdowns, and cuts
 * down mis-selection (wrong truck/wrong cuve) at the source.
 *
 * The QR payload is just a URL over the entity's existing UUID — no
 * separate secret/token table is needed, because every lookup still
 * goes through Supabase RLS: a scanned vehicle/tank/driver id from
 * another organisation simply resolves to nothing (see
 * supabase/migrations/20260101000009_rls_policies.sql), it can never
 * leak cross-tenant data.
 */
export type ScanEntityType = "vehicle" | "tank" | "driver";

const SCAN_TYPES: readonly ScanEntityType[] = ["vehicle", "tank", "driver"];

export function buildScanUrl(type: ScanEntityType, id: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/scan/${type}/${id}`;
}

export interface ScanPayload {
  type: ScanEntityType;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts either a full `/scan/<type>/<id>` URL (a sticker scanned by
 * the phone's native camera) or a bare `<type>:<id>` string (decoded
 * in-app by components/fuel/QrScanner.tsx without a round trip
 * through the browser's URL bar).
 */
export function parseScanPayload(raw: string): ScanPayload | null {
  const trimmed = raw.trim();

  const bareMatch = trimmed.match(/^(vehicle|tank|driver):([0-9a-f-]{36})$/i);
  const bareType = bareMatch?.[1];
  const bareId = bareMatch?.[2];
  if (bareType && bareId) {
    return { type: bareType.toLowerCase() as ScanEntityType, id: bareId };
  }

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const scanIndex = parts.indexOf("scan");
    if (scanIndex === -1) return null;
    const type = parts[scanIndex + 1];
    const id = parts[scanIndex + 2];
    if (!type || !id || !SCAN_TYPES.includes(type as ScanEntityType) || !UUID_RE.test(id)) {
      return null;
    }
    return { type: type as ScanEntityType, id };
  } catch {
    return null;
  }
}
