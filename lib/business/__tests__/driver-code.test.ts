import { describe, expect, it } from "vitest";
import { initialsOf, birthMonthYear, computeDriverCodeBase, normalizeDriverCodeInput } from "../driver-code";

describe("initialsOf", () => {
  it("takes first letter of first and last name", () => {
    expect(initialsOf("François Theobald")).toBe("FT");
  });

  it("removes accents (codes typed on any keyboard)", () => {
    expect(initialsOf("émilie dupont")).toBe("ED");
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
    expect(birthMonthYear("1988-11-15")).toBe("1188");
  });

  it("keeps the leading zero on single-digit months", () => {
    expect(birthMonthYear("2001-03-02")).toBe("0301");
  });
});

describe("computeDriverCodeBase", () => {
  it("combines initials and birth month/year", () => {
    expect(computeDriverCodeBase("François Theobald", "1988-11-15")).toBe("FT1188");
  });
});

describe("format FT1188", () => {
  it("initiales sans accents, mois et année sur deux chiffres", () => {
    expect(computeDriverCodeBase("François THËOBALD", "1988-11-03")).toBe("FT1188");
    expect(computeDriverCodeBase("Élodie Ébrard", "1995-02-20")).toBe("EE0295");
    expect(computeDriverCodeBase("Jean-Pierre Dupont-Martin", "1979-07-01")).toBe("JD0779");
  });
  it("normalise la saisie à la pompe", () => {
    expect(normalizeDriverCodeInput(" ft 11/88 ")).toBe("FT1188");
    expect(normalizeDriverCodeInput("100001")).toBe("100001");
  });
});
