import { describe, expect, it } from "vitest";
import { textSafeVariant } from "@/lib/theme/contrast";

function luminance(hex: string): number {
  const linearize = (channel: number) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const r = linearize(parseInt(hex.slice(1, 3), 16) / 255);
  const g = linearize(parseInt(hex.slice(3, 5), 16) / 255);
  const b = linearize(parseInt(hex.slice(5, 7), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastAgainstPaper(hex: string): number {
  const paper = luminance("#F6F7FB");
  const color = luminance(hex);
  const lighter = Math.max(paper, color);
  const darker = Math.min(paper, color);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("textSafeVariant", () => {
  it("leaves an already-readable dark color untouched", () => {
    expect(textSafeVariant("#0A0F1E")).toBe("#0A0F1E");
  });

  it("darkens a pale color that would fail contrast as text", () => {
    const pale = "#FFF176"; // pale yellow
    expect(contrastAgainstPaper(pale)).toBeLessThan(4.5);
    const safe = textSafeVariant(pale);
    expect(contrastAgainstPaper(safe)).toBeGreaterThanOrEqual(4.4);
  });

  it("darkens the app's own bright teal enough to read as text", () => {
    const safe = textSafeVariant("#1BE4C1");
    expect(contrastAgainstPaper(safe)).toBeGreaterThanOrEqual(4.4);
  });

  it("passes through malformed input instead of throwing", () => {
    expect(textSafeVariant("not-a-color")).toBe("not-a-color");
  });
});
