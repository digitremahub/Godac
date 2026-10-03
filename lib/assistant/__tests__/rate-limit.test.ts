import { describe, expect, it } from "vitest";
import { isWithinMessageRateLimit } from "../rate-limit";

const NOW = new Date("2026-01-01T12:00:00Z");

function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 60 * 1000);
}

describe("isWithinMessageRateLimit", () => {
  it("allows a fresh user with no prior messages", () => {
    expect(isWithinMessageRateLimit([], { now: NOW })).toBe(true);
  });

  it("allows up to (max - 1) recent messages", () => {
    const timestamps = Array.from({ length: 19 }, () => minutesAgo(5));
    expect(isWithinMessageRateLimit(timestamps, { now: NOW, max: 20 })).toBe(true);
  });

  it("blocks once the max is reached within the window", () => {
    const timestamps = Array.from({ length: 20 }, () => minutesAgo(5));
    expect(isWithinMessageRateLimit(timestamps, { now: NOW, max: 20 })).toBe(false);
  });

  it("ignores messages older than the window", () => {
    const timestamps = Array.from({ length: 20 }, () => minutesAgo(120));
    expect(isWithinMessageRateLimit(timestamps, { now: NOW, max: 20, windowMs: 60 * 60 * 1000 })).toBe(true);
  });
});
