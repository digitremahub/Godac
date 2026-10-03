import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { extractRowsWithAI } from "../ai-extract";

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

describe("extractRowsWithAI", () => {
  it("fails cleanly when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await extractRowsWithAI("some raw text", "vehicles");
    expect(result).toEqual({ ok: false, reason: "ANTHROPIC_API_KEY is not configured" });
  });

  it("parses the structured tool_use response into rows", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "extracted_rows",
                input: { rows: [{ registration: "AB-123-CD", type: "PL", service: "ABL" }] },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await extractRowsWithAI("raw sheet dump", "vehicles");
    expect(result).toEqual({ ok: true, rows: [{ registration: "AB-123-CD", type: "PL", service: "ABL" }] });
  });

  it("reports a clean failure on a non-2xx API response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));

    const result = await extractRowsWithAI("raw sheet dump", "drivers");
    expect(result.ok).toBe(false);
  });
});
