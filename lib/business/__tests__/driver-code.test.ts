import { describe, expect, it } from "vitest";
import { initialsOf, birthMonthYear, computeDriverCodeBase } from "../driver-code";

describe("initialsOf", () => {
  it("takes first letter of first and last name", () => {
    expect(initialsOf("François Theobald")).toBe("FT");
  });

  it("uppercases accented letters correctly", () => {
    expect(initialsOf("émilie dupont")).toBe("ÉD");
  });

  it("falls back to the same letter twice for a single-word name", () => {
    expect(initialsOf("Cher")).toBe("CC");
  });

  it("ignores extra whitespace", () => {
    expect(initialsOf("  Jean   Paul   Martin  ")).toBe("JM");
  });
});

describe("birthMonthYear", () => {
  it("formats month/2-digit-year", () => {
    expect(birthMonthYear("1988-11-15")).toBe("11/88");
  });

  it("keeps the leading zero on single-digit months", () => {
    expect(birthMonthYear("2001-03-02")).toBe("03/01");
  });
});

describe("computeDriverCodeBase", () => {
  it("combines initials and birth month/year", () => {
    expect(computeDriverCodeBase("François Theobald", "1988-11-15")).toBe("FT11/88");
  });
});
