// Shared (client + server) — the server-only listing lives in ./documents.ts.

export const VEHICLE_DOC_TYPES = [
  "Carte grise (certificat d'immatriculation)",
  "Attestation d'assurance",
  "Contrôle technique",
  "Licence communautaire / de transport",
  "Carte conducteur / chronotachygraphe",
  "Contrat de location / leasing",
  "Autre",
] as const;

export interface VehicleDocument {
  id: string;
  docType: string;
  expiresOn: string | null;
  driverVisible: boolean;
  uploadedAt: string;
  /** Short-lived signed URL — the bucket itself is private. */
  url: string | null;
}

/** "expired" | "soon" (≤ 30 days) | "ok" | null — compared on the Paris calendar day. */
export function expiryStatus(expiresOn: string | null, today: string): "expired" | "soon" | "ok" | null {
  if (!expiresOn) return null;
  if (expiresOn < today) return "expired";
  const in30 = new Date(`${today}T00:00:00Z`);
  in30.setUTCDate(in30.getUTCDate() + 30);
  return expiresOn <= in30.toISOString().slice(0, 10) ? "soon" : "ok";
}
