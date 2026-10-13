import { describe, expect, it } from "vitest";
import { datetimeLocalToIso, isoToDatetimeLocal, toDatetimeLocalValue } from "@/lib/utils/datetime-local";

describe("datetime-local", () => {
  it("formate l'heure murale locale, pas l'UTC", () => {
    const d = new Date(2026, 6, 14, 9, 5, 42); // 14/07/2026 09:05 heure locale
    expect(toDatetimeLocalValue(d)).toBe("2026-07-14T09:05");
  });

  it("aller-retour valeur locale → ISO → valeur locale", () => {
    const iso = datetimeLocalToIso("2026-01-03T23:45");
    expect(iso).toBe(new Date(2026, 0, 3, 23, 45).toISOString());
    expect(isoToDatetimeLocal(iso)).toBe("2026-01-03T23:45");
  });

  it("vide ou invalide", () => {
    expect(datetimeLocalToIso("")).toBeNull();
    expect(datetimeLocalToIso("pas une date")).toBeNull();
    expect(isoToDatetimeLocal(null)).toBe("");
    expect(isoToDatetimeLocal("n'importe quoi")).toBe("");
  });
});
