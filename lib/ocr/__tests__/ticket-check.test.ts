import { describe, expect, it } from "vitest";
import { classifyTicketFuel, ticketAmountMismatch, ticketExtrasFromOcrRaw } from "../ticket-check";

describe("ticketExtrasFromOcrRaw", () => {
  it("lit `fields` posé par le pipeline", () => {
    expect(ticketExtrasFromOcrRaw({ fields: { total_amount: 96.98, fuel_type: "Gazole" } })).toEqual({
      total_amount: 96.98,
      fuel_type: "Gazole",
    });
  });

  it("retrouve le bloc tool_use de la réponse brute", () => {
    const raw = { content: [{ type: "text" }, { type: "tool_use", name: "fuel_receipt", input: { total_amount: 12.5, fuel_type: "AdBlue" } }] };
    expect(ticketExtrasFromOcrRaw(raw)).toEqual({ total_amount: 12.5, fuel_type: "AdBlue" });
  });

  it("absent ou malformé → nulls", () => {
    expect(ticketExtrasFromOcrRaw(null)).toEqual({ total_amount: null, fuel_type: null });
    expect(ticketExtrasFromOcrRaw({ content: "x" })).toEqual({ total_amount: null, fuel_type: null });
    expect(ticketExtrasFromOcrRaw({ fields: { total_amount: "12", fuel_type: " " } })).toEqual({ total_amount: null, fuel_type: null });
  });
});

describe("classifyTicketFuel", () => {
  it.each([
    ["Gazole", "gazole"],
    ["GASOIL B7", "gazole"],
    ["Diesel", "gazole"],
    ["AdBlue", "adblue"],
    ["AD BLUE", "adblue"],
    ["SP95-E10", "essence"],
    ["Sans Plomb 98", "essence"],
    ["E85", "essence"],
    ["", "inconnu"],
    [null, "inconnu"],
    ["GPL", "inconnu"],
  ])("%s → %s", (label, expected) => {
    expect(classifyTicketFuel(label)).toBe(expected);
  });
});

describe("ticketAmountMismatch", () => {
  it("dans la tolérance → null", () => {
    expect(ticketAmountMismatch(54.2, 1.789, 96.96)).toBeNull();
    // 0,40 € d'écart sur un petit ticket : sous 0,50 €.
    expect(ticketAmountMismatch(10, 1.8, 18.4)).toBeNull();
    // 1,50 € sur 100 € : sous 2 %.
    expect(ticketAmountMismatch(100, 1.8, 181.5)).toBeNull();
  });

  it("hors tolérance → écart signé", () => {
    expect(ticketAmountMismatch(54.2, 1.789, 120)).toEqual({ computed: 96.96, ticket: 120, gap: -23.04 });
    expect(ticketAmountMismatch(10, 1.8, 17)).toEqual({ computed: 18, ticket: 17, gap: 1 });
  });

  it("donnée manquante → null", () => {
    expect(ticketAmountMismatch(null, 1.8, 18)).toBeNull();
    expect(ticketAmountMismatch(10, 1.8, null)).toBeNull();
    expect(ticketAmountMismatch(10, 0, 18)).toBeNull();
  });
});
