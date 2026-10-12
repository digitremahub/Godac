import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "../post-login";

describe("safeRedirectPath", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirectPath("/scan/vehicle/123")).toBe("/scan/vehicle/123");
  });
  it("falls back to the dashboard", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
  });
  it("refuses outside or protocol-relative URLs", () => {
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.example")).toBe("/dashboard");
  });
  it("doesn't loop back to the sign-in page", () => {
    expect(safeRedirectPath("/sign-in")).toBe("/dashboard");
  });
});
