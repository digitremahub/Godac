import { datetimeLocalToIso } from "@/lib/utils/datetime-local";

/**
 * Valeurs du formulaire de plein (components/fuel/FuelEntryForm.tsx) →
 * corps de POST /api/fuel-entries ou PATCH /api/fuel-entries/[id].
 * Deux cas, comme l'API :
 * - achat en station : litres, prix au litre, produit, station — ni
 *   cuve ni totaliseur ;
 * - plein à la cuve : totaliseur avant/après, litres et prix déduits
 *   côté serveur s'ils ne sont pas saisis.
 * Un champ vide n'est jamais envoyé comme 0 (Number("") === 0).
 */

export type FuelProduct = "gazole" | "adblue";

export interface FuelEntryFormValues {
  occurred_at: string;
  totalizer_before: string;
  totalizer_after: string;
  totalizer_before_photo_path: string;
  totalizer_after_photo_path: string;
  vehicle_km: string;
  liters: string;
  unit_price: string;
  station_name: string;
  product: FuelProduct;
}

/** "" / espaces / non numérique → null ; accepte la virgule décimale. */
export function parseDecimal(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim().replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Message d'erreur (français) si les valeurs ne peuvent pas être envoyées, sinon null. */
export function validateFuelEntryValues(values: FuelEntryFormValues, station: boolean): string | null {
  if (!datetimeLocalToIso(values.occurred_at)) return "Indiquez la date et l'heure du plein.";
  const km = parseDecimal(values.vehicle_km);
  if (values.vehicle_km.trim() && (km === null || km < 0)) return "Kilométrage invalide.";
  if (station) {
    const liters = parseDecimal(values.liters);
    if (liters === null || liters <= 0) return "Indiquez le nombre de litres du ticket.";
    const price = parseDecimal(values.unit_price);
    if (price === null || price <= 0) return "Indiquez le prix au litre du ticket (supérieur à 0).";
    return null;
  }
  const after = parseDecimal(values.totalizer_after);
  if (after === null || after <= 0) return "Indiquez l'index du totaliseur après le plein.";
  const before = parseDecimal(values.totalizer_before);
  if (values.totalizer_before.trim() && before === null) return "Index du totaliseur avant invalide.";
  if (before !== null && after <= before) return "L'index après le plein doit être supérieur à l'index avant.";
  return null;
}

/**
 * Corps de requête. `method` : POST omet tank_id pour une station (le
 * plein ne vise aucune cuve), PATCH envoie tank_id: null pour détacher
 * une cuve posée à tort. Le tank_id d'un plein cuve est ajouté par l'appelant.
 */
export function fuelEntryPayload(values: FuelEntryFormValues, opts: { station: boolean; method: "POST" | "PATCH" }): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    occurred_at: datetimeLocalToIso(values.occurred_at) ?? undefined,
    vehicle_km: parseDecimal(values.vehicle_km) ?? undefined,
  };
  const liters = parseDecimal(values.liters);
  const price = parseDecimal(values.unit_price);
  if (opts.station) {
    if (opts.method === "PATCH") payload.tank_id = null;
    payload.liters = liters ?? undefined;
    payload.unit_price = price !== null && price > 0 ? price : undefined;
    payload.product = values.product;
    const station = values.station_name.trim();
    payload.station_name = station || (opts.method === "PATCH" ? null : undefined);
    return payload;
  }
  payload.totalizer_before = parseDecimal(values.totalizer_before);
  payload.totalizer_after = parseDecimal(values.totalizer_after) ?? undefined;
  payload.totalizer_before_photo_path = values.totalizer_before_photo_path || undefined;
  payload.totalizer_after_photo_path = values.totalizer_after_photo_path || undefined;
  if (liters !== null && liters > 0) payload.liters = liters;
  if (price !== null && price > 0) payload.unit_price = price;
  return payload;
}
