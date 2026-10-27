import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { extractTourReportFromImage, normaliserLecture, tourReportSchema } from "../tour-report";

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

function validFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tour_number: "106",
    bl_number: "376646",
    stops_total: 61,
    packages_count: 90,
    priority_count: 1,
    stops_delivered: null,
    packages_missing: null,
    pickups: null,
    departure_time: null,
    return_time: null,
    packages_picked_up: null,
    packages_returned: null,
    packages_relay: null,
    ...overrides,
  };
}

describe("tourReportSchema", () => {
  it("accepts a well-formed extraction", () => {
    expect(tourReportSchema.safeParse(validFields()).success).toBe(true);
  });

  it("accepts every field being null (nothing legible on the photo)", () => {
    const allNull = Object.fromEntries(Object.keys(validFields()).map((k) => [k, null]));
    expect(tourReportSchema.safeParse(allNull).success).toBe(true);
  });

  it("rejects a negative count", () => {
    expect(tourReportSchema.safeParse(validFields({ stops_total: -1 })).success).toBe(false);
  });

  it("rejects a missing required key", () => {
    const { stops_total: _omit, ...rest } = validFields();
    expect(tourReportSchema.safeParse(rest).success).toBe(false);
  });
});

describe("extractTourReportFromImage", () => {
  it("fails cleanly when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(result).toEqual({ ok: false, reason: "ANTHROPIC_API_KEY is not configured" });
  });

  it("parses a structured tool_use response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "tour_report", input: validFields() }] }), { status: 200 }),
      ),
    );
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.tour_number).toBe("106");
      expect(result.fields.packages_count).toBe(90);
    }
  });

  it("reports a clean failure when the tool response is malformed", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "tour_report", input: { stops_total: -5 } } ] }), {
          status: 200,
        }),
      ),
    );
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(result.ok).toBe(false);
  });

  it("reports a clean failure on a non-2xx API response", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(result.ok).toBe(false);
  });
});

describe("extractTourReportFromImage : erreurs, délai, nouvel essai", () => {
  const reponseOk = () => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "tour_report", input: validFields() }], usage: { input_tokens: 1200, output_tokens: 300 } }), { status: 200 });

  it("ne renvoie jamais le corps brut de l'erreur de l'API au client", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"type":"error","error":{"message":"credit balance too low, org_12345"}}', { status: 400 })));
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toMatch(/credit|org_12345|Anthropic|400/);
    // Le détail reste au journal serveur.
    expect(journal.mock.calls.flat().join(" ")).toContain("credit balance too low");
  });

  it("un appel borné par un délai, et un seul nouvel essai sur une erreur passagère", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response("surcharge", { status: 529 }));
    fetchMock.mockImplementationOnce(async () => new Response("surcharge", { status: 529 }));
    fetchMock.mockImplementationOnce(async () => reponseOk());
    vi.stubGlobal("fetch", fetchMock);
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("n'insiste pas au-delà d'un nouvel essai", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response("surcharge", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un délai dépassé est retenté une fois puis donne un message générique", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => { throw new DOMException("délai", "TimeoutError"); });
    vi.stubGlobal("fetch", fetchMock);
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).not.toMatch(/Timeout|délai dépassé/);
  });

  it("renvoie les jetons consommés pour la journalisation", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => reponseOk()));
    const result = await extractTourReportFromImage(Buffer.from("fake"), "photo.jpg");
    expect(result.ok && result.jetons).toEqual({ entree: 1200, sortie: 300 });
  });
});

describe("lecture du scan", () => {
  it("déduit les stops de ramasse du total imprimé", () => {
    const { stops_total: _t, ...brut } = validFields({ pickups: 4 });
    const lu = normaliserLecture({ ...brut, stops_scan: 61 }) as Record<string, unknown>;
    expect(lu.stops_total).toBe(57);
    expect(lu.stops_scan).toBe(61);
    expect(tourReportSchema.safeParse(lu).success).toBe(true);
  });

  it("garde le total quand aucune ramasse n'est lisible", () => {
    const { stops_total: _t, ...brut } = validFields();
    expect((normaliserLecture({ ...brut, stops_scan: 61 }) as Record<string, unknown>).stops_total).toBe(61);
  });

  it("les colis REMIS de l'IA arrivent dans stops_delivered après extraction", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { stops_total: _t, ...brut } = validFields({ pickups: 3, stops_delivered: 52 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: [{ type: "tool_use", name: "tour_report", input: { ...brut, stops_scan: 58 } }] }), { status: 200 }),
      ),
    );
    const result = await extractTourReportFromImage(Buffer.from("fake"), "scan.pdf");
    expect(result.ok && result.fields.stops_total).toBe(55);
    expect(result.ok && result.fields.stops_delivered).toBe(52);
  });
});
