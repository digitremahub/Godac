import { describe, expect, it } from "vitest";
import { checkOdometerJump, checkOdometerNotRegressing, checkTourDistanceGap } from "../odometer";

describe("checkOdometerNotRegressing", () => {
  it("passes when there is no prior reading yet", () => {
    expect(checkOdometerNotRegressing(100, null, "le dernier relevé connu")).toEqual({ ok: true, message: null });
  });

  it("passes when the new reading is ahead of the reference", () => {
    expect(checkOdometerNotRegressing(1050, 1000, "le dernier relevé connu")).toEqual({ ok: true, message: null });
  });

  it("passes when the new reading equals the reference", () => {
    expect(checkOdometerNotRegressing(1000, 1000, "le dernier relevé connu")).toEqual({ ok: true, message: null });
  });

  it("rejects a reading behind the reference, with a clear message", () => {
    const result = checkOdometerNotRegressing(950, 1000, "le dernier relevé connu");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("950");
    expect(result.message).toContain("1000");
  });
});

describe("checkTourDistanceGap", () => {
  it("computes a normal tour distance without flagging it", () => {
    expect(checkTourDistanceGap(1000, 1300)).toEqual({ gapKm: 300, isLargeGap: false });
  });

  it("flags a tour covering more than 1500 km", () => {
    const result = checkTourDistanceGap(1000, 3000);
    expect(result.gapKm).toBe(2000);
    expect(result.isLargeGap).toBe(true);
  });

  it("does not flag exactly 1500 km", () => {
    expect(checkTourDistanceGap(1000, 2500).isLargeGap).toBe(false);
  });
});

describe("checkOdometerJump", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("accepte une progression plausible", () => {
    expect(checkOdometerJump(126_400, 125_430, "2026-10-12T12:00:00Z", now).ok).toBe(true);
  });
  it("refuse une faute de frappe (un chiffre en trop)", () => {
    expect(checkOdometerJump(1_254_300, 125_430, "2026-10-12T12:00:00Z", now).ok).toBe(false);
  });
  it("tient compte du temps écoulé", () => {
    expect(checkOdometerJump(140_000, 125_430, "2026-09-30T12:00:00Z", now).ok).toBe(true);
  });
  it("sans référence : accepté", () => {
    expect(checkOdometerJump(125_430, null, null, now).ok).toBe(true);
  });
});
