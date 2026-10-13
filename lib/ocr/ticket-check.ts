/**
 * Contrôles d'un ticket de station lu par OCR (lib/ocr/fuel-receipt.ts),
 * affichés à la validation humaine : montant du ticket contre
 * litres × prix, et produit lu (AdBlue / essence à la place du gazole).
 * Pur — utilisé côté serveur (pipeline) comme côté navigateur.
 */

export interface TicketExtras {
  total_amount: number | null;
  fuel_type: string | null;
}

export type TicketProduct = "gazole" | "adblue" | "essence" | "inconnu";

/** Écart toléré entre litres × prix et le total du ticket : 2 % ou 0,50 €, le plus large des deux. */
export const TICKET_TOLERANCE_PERCENT = 2;
export const TICKET_TOLERANCE_EUROS = 0.5;

/**
 * Total et type de carburant lus sur le ticket, depuis fuel_entries.ocr_raw :
 * soit `fields` (posé par le pipeline), soit la réponse brute de l'API
 * (bloc tool_use « fuel_receipt ») pour les lignes plus anciennes.
 */
export function ticketExtrasFromOcrRaw(raw: unknown): TicketExtras {
  const empty: TicketExtras = { total_amount: null, fuel_type: null };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as { fields?: unknown; content?: { type?: string; name?: string; input?: unknown }[] };
  const source =
    r.fields && typeof r.fields === "object"
      ? r.fields
      : Array.isArray(r.content)
        ? r.content.find((c) => c?.type === "tool_use" && c?.name === "fuel_receipt")?.input
        : null;
  if (!source || typeof source !== "object") return empty;
  const s = source as { total_amount?: unknown; fuel_type?: unknown };
  const total = typeof s.total_amount === "number" && Number.isFinite(s.total_amount) ? s.total_amount : null;
  const fuel = typeof s.fuel_type === "string" && s.fuel_type.trim() ? s.fuel_type.trim() : null;
  return { total_amount: total, fuel_type: fuel };
}

/** Classe le libellé carburant du ticket. */
export function classifyTicketFuel(fuelType: string | null | undefined): TicketProduct {
  if (!fuelType) return "inconnu";
  const f = fuelType.toLowerCase();
  if (/ad ?blue|\bdef\b|\barla\b|urée|uree/.test(f)) return "adblue";
  if (/gazole|gasoil|gas-oil|diesel|\bb7\b|\bb10\b|\bxtl\b|\bhvo\b/.test(f)) return "gazole";
  if (/essence|sans ?plomb|\bsp ?9[58]\b|\bsp\b|\be ?10\b|\be ?5\b|\be ?85\b|super/.test(f)) return "essence";
  return "inconnu";
}

/**
 * Écart entre litres × prix saisis et le total du ticket, en euros ;
 * null si l'un des trois manque ou si l'écart est dans la tolérance.
 */
export function ticketAmountMismatch(
  liters: number | null | undefined,
  unitPrice: number | null | undefined,
  ticketTotal: number | null | undefined,
): { computed: number; ticket: number; gap: number } | null {
  if (liters == null || unitPrice == null || ticketTotal == null) return null;
  if (!Number.isFinite(liters) || !Number.isFinite(unitPrice) || !Number.isFinite(ticketTotal) || liters <= 0 || unitPrice <= 0) return null;
  const computed = Math.round(liters * unitPrice * 100) / 100;
  const gap = Math.round((computed - ticketTotal) * 100) / 100;
  const tolerance = Math.max(TICKET_TOLERANCE_EUROS, (Math.abs(ticketTotal) * TICKET_TOLERANCE_PERCENT) / 100);
  return Math.abs(gap) > tolerance ? { computed, ticket: ticketTotal, gap } : null;
}
