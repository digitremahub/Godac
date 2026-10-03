import { describe, expect, it } from "vitest";
import { generateTourNumber } from "../tour-number";

describe("generateTourNumber", () => {
  it("combines the date and registration with spaces stripped", () => {
    expect(generateTourNumber("AB-123-CD", new Date(2026, 0, 5))).toBe("20260105-AB-123-CD");
  });

  it("strips internal spaces from the registration", () => {
    expect(generateTourNumber("AB 123 CD", new Date(2026, 11, 31))).toBe("20261231-AB123CD");
  });
});
