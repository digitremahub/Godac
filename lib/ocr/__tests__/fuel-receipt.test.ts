import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { extractFuelReceipt, fuelReceiptSchema } from "../fuel-receipt";

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

function validFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    date: "2026-03-14",
    time: "08:12",
    liters: 54.2,
    unit_price: 1.789,
    total_amount: 96.98,
    station_name: "Total Access",
    fuel_type: "gazole",
    ...overrides,
  };
}

describe("fuelReceiptSchema", () => {
  it("accepts a well-formed extraction", () => {
    expect(fuelReceiptSchema.safeParse(validFields()).success).toBe(true);
  });

  it("accepts every field being null (nothing legible on the ticket)", () => {
    const allNull = Object.fromEntries(Object.keys(validFields()).map((k) => [k, null]));
    expect(fuelReceiptSchema.safeParse(allNull).success).toBe(true);
  });

  it("rejects a negative amount", () => {
    expect(fuelReceiptSchema.safeParse(validFields({ liters: -1 })).success).toBe(false);
  });

  it("rejects a missing required key", () => {
    const { liters: _omit, ...rest } = validFields();
    expect(fuelReceiptSchema.safeParse(rest).success).toBe(false);
  });
});

describe("extractFuelReceipt", () => {
  it("fails cleanly when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await extractFuelReceipt(Buffer.from("fake"), "ticket.jpg");
    expect(result).toEqual({ ok: false, reason: "ANTHROPIC_API_KEY is not configured" });
  });

  it("parses a structured tool_use response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "fuel_receipt", input: validFields() }] }), { status: 200 }),
      ),
    );
    const result = await extractFuelReceipt(Buffer.from("fake"), "ticket.jpg");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.liters).toBe(54.2);
      expect(result.fields.station_name).toBe("Total Access");
    }
  });

  it("reports a clean failure when the tool response is malformed", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "fuel_receipt", input: { liters: -5 } }] }), { status: 200 }),
      ),
    );
    const result = await extractFuelReceipt(Buffer.from("fake"), "ticket.jpg");
    expect(result.ok).toBe(false);
  });

  it("reports a clean failure on a non-2xx API response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const result = await extractFuelReceipt(Buffer.from("fake"), "ticket.jpg");
    expect(result.ok).toBe(false);
  });
});
