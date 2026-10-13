import { describe, expect, it } from "vitest";
import { summarizeFuelRows } from "../totals";

describe("summarizeFuelRows", () => {
  it("ignore les tickets non validés et sépare gazole / AdBlue", () => {
    const totals = summarizeFuelRows([
      { liters: 100, total_amount: 180, status: "manual", product: "gazole" },
      { liters: "50", total_amount: "90", status: "validated", product: "gazole" },
      { liters: 20, total_amount: 16, status: "validated", product: "adblue" },
      { liters: 300, total_amount: 540, status: "awaiting_validation", product: "gazole" },
      { liters: 300, total_amount: 540, status: "ocr_failed", product: "gazole" },
      { liters: null, total_amount: null, status: "pending_ocr" },
    ]);
    expect(totals).toEqual({ gazoleLiters: 150, adblueLiters: 20, cost: 286, gazoleCost: 270, count: 3 });
  });

  it("produit absent = gazole (valeur par défaut de la colonne)", () => {
    expect(summarizeFuelRows([{ liters: 10, total_amount: 18, status: "manual" }]).gazoleLiters).toBe(10);
  });
});
