import { describe, expect, it } from "vitest";
import { buildScanUrl, parseScanPayload } from "../scan-targets";

const SAMPLE_ID = "0f7a1e3a-9b2b-4c3d-8f1a-2b3c4d5e6f7a";

describe("buildScanUrl / parseScanPayload round-trip", () => {
  it("round-trips a vehicle QR URL", () => {
    const url = buildScanUrl("vehicle", SAMPLE_ID);
    expect(parseScanPayload(url)).toEqual({ type: "vehicle", id: SAMPLE_ID });
  });

  it("parses the compact in-app scan payload", () => {
    expect(parseScanPayload(`tank:${SAMPLE_ID}`)).toEqual({ type: "tank", id: SAMPLE_ID });
  });

  it("rejects an unrelated URL", () => {
    expect(parseScanPayload("https://example.com/not-godac")).toBeNull();
  });

  it("rejects a malformed id", () => {
    expect(parseScanPayload("driver:not-a-uuid")).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    expect(parseScanPayload("not a url at all")).toBeNull();
  });
});
