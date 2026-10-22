import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { lireBordereau } from "../bordereau";

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Flux SSE de l'API, découpé en morceaux arbitraires comme sur le réseau. */
function flux(evenements: object[], stopReason = "tool_use"): Response {
  const lignes = [
    { type: "message_start", message: { usage: { input_tokens: 1500 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "bordereau", input: {} } },
    ...evenements,
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 300 } },
    { type: "message_stop" },
  ]
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  const octets = new TextEncoder().encode(lignes);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < octets.length; i += 37) c.enqueue(octets.slice(i, i + 37));
        c.close();
      },
    }),
    { status: 200 },
  );
}

// Page fictive (données inventées).
const ARGS = JSON.stringify({
  lisible: true,
  entete: { transporteur: "GLS", numero: "A1", page: 1 },
  blocs: [{ position: 1, codes: [], nom: "DURAND PAUL", adresse: "4 AVENUE DU TEST", localite: "31000 TOULOUSE", telephone: null, colis: [], nombre_colis: 1 }],
});
const morceaux = (t: string) => Array.from({ length: Math.ceil(t.length / 20) }, (_, i) => ({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: t.slice(i * 20, i * 20 + 20) } }));

describe("lireBordereau", () => {
  it("sans clé : échec propre", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await lireBordereau("x", "image/jpeg")).toMatchObject({ ok: false, raison: "ia" });
  });

  it("reconstitue les arguments de l'outil depuis le flux", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetch = vi.fn(async () => flux(morceaux(ARGS)));
    vi.stubGlobal("fetch", fetch);
    const r = await lireBordereau("x", "image/jpeg");
    expect(r.ok && r.page.blocs[0]?.nom).toBe("DURAND PAUL");
    expect(r.ok && r.page.entete.transporteur).toBe("GLS");
    const corps = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(corps).toMatchObject({ stream: true, thinking: { type: "disabled" }, tool_choice: { type: "tool", name: "bordereau" } });
    expect(corps.temperature).toBeUndefined();
  });

  it("400 : erreur journalisée, puis un essai avec la forme de repli", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "exemple" } }), { status: 400 }))
      .mockResolvedValueOnce(flux(morceaux(ARGS)));
    vi.stubGlobal("fetch", fetch);
    const r = await lireBordereau("x", "image/jpeg");
    expect(r.ok).toBe(true);
    expect(String(log.mock.calls[0]?.[1])).toContain("invalid_request_error");
    const repli = JSON.parse((fetch.mock.calls[1] as [string, { body: string }])[1].body);
    expect(repli.tool_choice).toEqual({ type: "auto" });
    expect(repli.thinking).toBeUndefined();
  });

  it("400 deux fois : raison « ia » avec le corps de l'erreur", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"refus exemple"}}', { status: 400 })));
    const r = await lireBordereau("x", "image/jpeg");
    expect(r).toMatchObject({ ok: false, raison: "ia" });
    expect(!r.ok && r.detail).toContain("refus exemple");
  });

  it("réponse coupée (max_tokens) : raison « dense »", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => flux(morceaux(ARGS.slice(0, 60)), "max_tokens")));
    expect(await lireBordereau("x", "image/jpeg")).toMatchObject({ ok: false, raison: "dense" });
  });
});
