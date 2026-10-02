import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { askAssistant } from "../client";

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

const BASE_ARGS = {
  context: { role: "chauffeur", serviceNames: ["Dépôt Sud"], enabledModuleKeys: ["fuel_tracking"], emergencyPhone: null },
  sources: [{ title: "Tournée", content: "Pour démarrer une tournée..." }],
  history: [],
  message: "Comment je démarre une tournée ?",
};

describe("askAssistant", () => {
  it("fails cleanly when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await askAssistant(BASE_ARGS);
    expect(result).toEqual({ ok: false, reason: "ANTHROPIC_API_KEY is not configured" });
  });

  it("parses a normal answer (needs_human false)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "assistant_reply",
                input: { answer: "Scanne le véhicule puis renseigne ton kilométrage.", needs_human: false, reason: null },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await askAssistant(BASE_ARGS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.needs_human).toBe(false);
      expect(result.response.answer).toContain("kilométrage");
    }
  });

  it("parses an escalation (needs_human true with a reason)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "assistant_reply",
                input: { answer: "Je ne peux pas répondre à ça, je transmets ta question.", needs_human: true, reason: "sujet RH" },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await askAssistant(BASE_ARGS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.needs_human).toBe(true);
      expect(result.response.reason).toBe("sujet RH");
    }
  });

  it("reports a clean failure on a malformed tool response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ content: [{ type: "tool_use", name: "assistant_reply", input: { answer: "x" } }] }),
          { status: 200 },
        ),
      ),
    );
    const result = await askAssistant(BASE_ARGS);
    expect(result.ok).toBe(false);
  });

  it("reports a clean failure on a non-2xx API response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const result = await askAssistant(BASE_ARGS);
    expect(result.ok).toBe(false);
  });
});
