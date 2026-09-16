import "server-only";

/**
 * Thin wrapper around the Mindee API (Module 3). Uses the generic
 * "financial document" endpoint by default — Mindee doesn't ship a
 * dedicated "fuel receipt" model — and switches to a custom-trained
 * model automatically once MINDEE_FUEL_MODEL_ID is set (per the spec:
 * "entraîner un modèle custom Mindee sur des tickets français").
 *
 * Never throws for a business-level extraction failure (bad photo,
 * unreadable ticket): callers get a structured
 * `{ ok: false, reason }` instead so the pipeline can fall back to
 * manual entry, per the "never block the workflow" requirement.
 */

export interface MindeeExtractionField<T> {
  value: T | null;
  confidence: number | null;
}

export interface MindeeFuelExtraction {
  date: MindeeExtractionField<string>;
  time: MindeeExtractionField<string>;
  liters: MindeeExtractionField<number>;
  unitPrice: MindeeExtractionField<number>;
  totalAmount: MindeeExtractionField<number>;
  stationName: MindeeExtractionField<string>;
  fuelType: MindeeExtractionField<string>;
}

export type MindeeResult =
  | { ok: true; extraction: MindeeFuelExtraction; raw: unknown }
  | { ok: false; reason: string };

const GENERIC_ENDPOINT =
  "https://api.mindee.net/v1/products/mindee/financial_document/v1/predict";

export async function extractFuelReceipt(
  imageBytes: Buffer,
  filename: string,
): Promise<MindeeResult> {
  const apiKey = process.env.MINDEE_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "MINDEE_API_KEY is not configured" };
  }

  const customModelId = process.env.MINDEE_FUEL_MODEL_ID;
  const endpoint = customModelId
    ? `https://api.mindee.net/v1/products/${customModelId}/predict`
    : GENERIC_ENDPOINT;

  const form = new FormData();
  form.append("document", new Blob([new Uint8Array(imageBytes)]), filename);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}` },
      body: form,
    });
  } catch (err) {
    return { ok: false, reason: `Mindee request failed: ${String(err)}` };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, reason: `Mindee returned HTTP ${response.status}: ${body.slice(0, 300)}` };
  }

  const json = await response.json();
  const prediction = json?.document?.inference?.prediction;
  if (!prediction) {
    return { ok: false, reason: "Mindee response missing prediction payload" };
  }

  return {
    ok: true,
    raw: json,
    extraction: customModelId
      ? mapCustomModelFields(prediction)
      : mapGenericFinancialDocumentFields(prediction),
  };
}

/** Field mapping for Mindee's generic "Financial Document" model. */
function mapGenericFinancialDocumentFields(prediction: any): MindeeFuelExtraction {
  return {
    date: field(prediction.date),
    time: field(prediction.time),
    liters: { value: null, confidence: null }, // not exposed by the generic model
    unitPrice: { value: null, confidence: null },
    totalAmount: field(prediction.total_amount),
    stationName: field(prediction.supplier_name),
    fuelType: { value: null, confidence: null },
  };
}

/**
 * Field mapping for a custom-trained "ticket carburant français"
 * model. Field names below match a plausible schema for such a
 * model; adjust to whatever field names the trained model actually
 * exposes in the Mindee Studio schema.
 */
function mapCustomModelFields(prediction: any): MindeeFuelExtraction {
  return {
    date: field(prediction.date),
    time: field(prediction.time),
    liters: field(prediction.volume_liters),
    unitPrice: field(prediction.unit_price),
    totalAmount: field(prediction.total_amount),
    stationName: field(prediction.station_name),
    fuelType: field(prediction.fuel_type),
  };
}

function field(raw: any): MindeeExtractionField<any> {
  if (!raw) return { value: null, confidence: null };
  return {
    value: raw.value ?? null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
  };
}
