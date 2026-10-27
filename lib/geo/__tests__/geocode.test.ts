import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DELAI_GEOCODAGE_MS, geocodeAddress, geocodeAddressDetail, reverseGeocode } from "@/lib/geo/geocode";

afterEach(() => vi.unstubAllGlobals());

describe("géocodage : jamais d'attente illimitée", () => {
  it("chaque appel (BAN et Nominatim) porte un AbortSignal", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ features: [{ geometry: { coordinates: [2, 48] }, properties: {} }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await geocodeAddress("1 rue de Paris", "FR");
    await geocodeAddressDetail("1 rue de Paris", "FR");
    await reverseGeocode(48, 2, "FR");
    await geocodeAddress("1 rue de Bruxelles", "BE");
    await geocodeAddressDetail("1 rue de Bruxelles", "BE");
    await reverseGeocode(50, 4, "BE");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) expect(init.signal, String(init)).toBeInstanceOf(AbortSignal);
    expect(DELAI_GEOCODAGE_MS).toBeLessThanOrEqual(10_000);
  });
  it("un délai dépassé donne « adresse introuvable », sans exception", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("délai", "TimeoutError"); }));
    expect(await geocodeAddress("1 rue de Paris")).toBeNull();
    expect(await geocodeAddressDetail("1 rue de Paris")).toBeNull();
    expect(await reverseGeocode(48, 2)).toBeNull();
  });
  it("corps illisible : null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("pas du json", { status: 200 })));
    expect(await geocodeAddress("1 rue de Paris")).toBeNull();
    expect(await reverseGeocode(48, 2)).toBeNull();
  });
});
