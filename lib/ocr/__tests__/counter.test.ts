import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { extractOdometerReading, extractTotalizerReading } from "../counter";

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

describe("extractOdometerReading / extractTotalizerReading", () => {
  it("fails cleanly when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await extractOdometerReading(Buffer.from("fake"), "photo.jpg");
    expect(result).toEqual({ ok: false, reason: "ANTHROPIC_API_KEY is not configured" });
  });

  it("parses a structured tool_use response for the odometer", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "counter_reading", input: { reading: 38958 } }] }), {
          status: 200,
        }),
      ),
    );
    const result = await extractOdometerReading(Buffer.from("fake"), "photo.jpg");
    expect(result).toEqual({ ok: true, reading: 38958 });
  });

  it("parses a structured tool_use response for the totalizer", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "counter_reading", input: { reading: 1204.5 } }] }), {
          status: 200,
        }),
      ),
    );
    const result = await extractTotalizerReading(Buffer.from("fake"), "photo.jpg");
    expect(result).toEqual({ ok: true, reading: 1204.5 });
  });

  it("passes through a null reading when nothing legible", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "counter_reading", input: { reading: null } }] }), {
          status: 200,
        }),
      ),
    );
    const result = await extractOdometerReading(Buffer.from("fake"), "photo.jpg");
    expect(result).toEqual({ ok: true, reading: null });
  });

  it("reports a clean failure when the tool response is malformed", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "counter_reading", input: { reading: -5 } }] }), {
          status: 200,
        }),
      ),
    );
    const result = await extractOdometerReading(Buffer.from("fake"), "photo.jpg");
    expect(result.ok).toBe(false);
  });

  it("reports a clean failure on a non-2xx API response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const result = await extractOdometerReading(Buffer.from("fake"), "photo.jpg");
    expect(result.ok).toBe(false);
  });
});
