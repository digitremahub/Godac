import { describe, expect, it } from "vitest";
import { computeHourlyRates, countWeekdays, estimateSalary, leaveDayHoursEquivalent } from "../payroll";

describe("computeHourlyRates", () => {
  it("divides monthly gross/net salary by contractual monthly hours", () => {
    const rates = computeHourlyRates({ monthlyGrossSalary: 2275.05, monthlyNetSalary: 1775.0, contractualMonthlyHours: 151.67 });
    expect(rates).not.toBeNull();
    expect(rates!.grossPerHour).toBeCloseTo(15, 1);
    expect(rates!.netPerHour).toBeCloseTo(11.7, 1);
  });

  it("computes the gross rate alone when only the contract's gross salary is known (no net on a payslip yet)", () => {
    const rates = computeHourlyRates({ monthlyGrossSalary: 1833.69, monthlyNetSalary: null, contractualMonthlyHours: 151.67 });
    expect(rates).not.toBeNull();
    expect(rates!.grossPerHour).toBeCloseTo(12.09, 2);
    expect(rates!.netPerHour).toBeNull();
  });

  it("is null when contractual hours is missing, zero or negative", () => {
    expect(computeHourlyRates({ monthlyGrossSalary: 2275, monthlyNetSalary: 1775, contractualMonthlyHours: null })).toBeNull();
    expect(computeHourlyRates({ monthlyGrossSalary: 2275, monthlyNetSalary: 1775, contractualMonthlyHours: 0 })).toBeNull();
    expect(computeHourlyRates({ monthlyGrossSalary: 2275, monthlyNetSalary: 1775, contractualMonthlyHours: -1 })).toBeNull();
  });
});

describe("estimateSalary", () => {
  it("multiplies worked hours by each rate", () => {
    const result = estimateSalary(140, { grossPerHour: 15, netPerHour: 11.7 });
    expect(result).toEqual({ gross: 2100, net: 1638 });
  });

  it("leaves net null when only the gross rate is known", () => {
    const result = estimateSalary(140, { grossPerHour: 12.09, netPerHour: null });
    expect(result?.gross).toBeCloseTo(1692.6, 1);
    expect(result?.net).toBeNull();
  });

  it("is null when rates are null", () => {
    expect(estimateSalary(140, null)).toBeNull();
  });
});

describe("countWeekdays", () => {
  it("counts only Mon-Fri in a range spanning a weekend", () => {
    // Mon 2026-08-10 .. Fri 2026-08-14 (a full working week)
    expect(countWeekdays(new Date("2026-08-10"), new Date("2026-08-14"))).toBe(5);
  });

  it("excludes the weekend itself", () => {
    // Sat 2026-08-15 .. Sun 2026-08-16
    expect(countWeekdays(new Date("2026-08-15"), new Date("2026-08-16"))).toBe(0);
  });

  it("is 0 when end is before start", () => {
    expect(countWeekdays(new Date("2026-08-14"), new Date("2026-08-10"))).toBe(0);
  });
});

describe("leaveDayHoursEquivalent", () => {
  it("divides contractual monthly hours by the average working days per month", () => {
    expect(leaveDayHoursEquivalent(151.67)).toBeCloseTo(7, 0);
  });
});
