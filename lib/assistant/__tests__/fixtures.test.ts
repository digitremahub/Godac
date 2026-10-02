import { describe, expect, it } from "vitest";
import { ASSISTANT_FIXTURES } from "./fixtures";

describe("ASSISTANT_FIXTURES", () => {
  it("has at least 15 example questions", () => {
    expect(ASSISTANT_FIXTURES.length).toBeGreaterThanOrEqual(15);
  });

  it("covers all three expected behaviors", () => {
    const behaviors = new Set(ASSISTANT_FIXTURES.map((f) => f.expected));
    expect(behaviors).toEqual(new Set(["répond", "relaie", "refuse"]));
  });

  it("every fixture has a non-empty question and note", () => {
    for (const fixture of ASSISTANT_FIXTURES) {
      expect(fixture.question.length).toBeGreaterThan(0);
      expect(fixture.note.length).toBeGreaterThan(0);
    }
  });
});
