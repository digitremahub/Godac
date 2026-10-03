import { describe, expect, it } from "vitest";
import { validatePin } from "../driver-pin";

describe("validatePin", () => {
  it("accepts a plausible 4-digit PIN", () => {
    expect(validatePin("7392")).toEqual({ ok: true, message: null });
  });

  it("accepts a plausible 6-digit PIN", () => {
    expect(validatePin("739204")).toEqual({ ok: true, message: null });
  });

  it("rejects anything that isn't 4-6 digits", () => {
    expect(validatePin("123").ok).toBe(false);
    expect(validatePin("1234567").ok).toBe(false);
    expect(validatePin("12a4").ok).toBe(false);
  });

  it("rejects all-identical-digit PINs", () => {
    expect(validatePin("0000").ok).toBe(false);
    expect(validatePin("999999").ok).toBe(false);
  });

  it("rejects ascending or descending sequences", () => {
    expect(validatePin("1234").ok).toBe(false);
    expect(validatePin("4321").ok).toBe(false);
    expect(validatePin("456789").ok).toBe(false);
  });
});
