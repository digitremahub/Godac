import { describe, expect, it } from "vitest";
import { shouldEscalateAfterFeedback } from "../escalation";

describe("shouldEscalateAfterFeedback", () => {
  it("does not escalate with fewer than two feedback entries", () => {
    expect(shouldEscalateAfterFeedback([false])).toBe(false);
    expect(shouldEscalateAfterFeedback([])).toBe(false);
  });

  it("does not escalate on one negative then one positive", () => {
    expect(shouldEscalateAfterFeedback([false, true])).toBe(false);
  });

  it("does not escalate on null (no feedback given) entries", () => {
    expect(shouldEscalateAfterFeedback([null, false])).toBe(false);
  });

  it("escalates on two consecutive negative feedbacks", () => {
    expect(shouldEscalateAfterFeedback([false, false])).toBe(true);
  });

  it("only looks at the last two entries", () => {
    expect(shouldEscalateAfterFeedback([false, true, false, false])).toBe(true);
    expect(shouldEscalateAfterFeedback([false, false, true, false])).toBe(false);
  });
});
