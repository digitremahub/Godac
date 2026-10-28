import { describe, expect, it } from "vitest";
import { schemaStockAbsent, traduireErreurStock } from "@/lib/stock/erreurs";
import { readFileSync } from "node:fs";

describe("erreurs du stock", () => {
  it("traduit les codes des fonctions SQL en français avec le bon statut", () => {
    expect(traduireErreurStock({ message: "stock_insuffisant" })).toMatchObject({ status: 409, message: expect.stringContaining("Stock insuffisant") });
    expect(traduireErreurStock({ message: "stock_role_refuse" })).toMatchObject({ status: 403 });
    expect(traduireErreurStock({ message: "stock_unite_inconnue" })).toMatchObject({ status: 404 });
    expect(traduireErreurStock({ message: "stock_transition_interdite" })).toMatchObject({ status: 409 });
    expect(traduireErreurStock({ message: "stock_non_authentifie" })).toMatchObject({ status: 401 });
    expect(traduireErreurStock({ message: "stock_module_inactif" })).toMatchObject({ status: 403 });
  });
  it("retrouve le code dans un message plus long", () => {
    expect(traduireErreurStock({ message: "P0001: stock_dlc_requise (contexte)" }).code).toBe("stock_dlc_requise");
  });
  it("fonction ou table absente = migration non appliquée (503)", () => {
    expect(traduireErreurStock({ code: "PGRST202", message: "Could not find the function" })).toMatchObject({ code: "stock_schema_absent", status: 503 });
    expect(traduireErreurStock({ code: "42P01", message: "relation does not exist" }).status).toBe(503);
    expect(schemaStockAbsent({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(schemaStockAbsent({ code: "23505", message: "dup" })).toBe(false);
  });
  it("erreur inconnue : message générique, aucun détail technique", () => {
    const e = traduireErreurStock({ code: "XX000", message: "select * from secret where password = 'x'" });
    expect(e.status).toBe(500);
    expect(e.message).not.toContain("secret");
  });
  it("tous les codes levés par les fonctions SQL sont traduits", () => {
    const sql = readFileSync("supabase/migrations/20261114000002_stock_fonctions.sql", "utf8") + readFileSync("supabase/migrations/20261114000001_stock_schema.sql", "utf8");
    const codes = new Set([...sql.matchAll(/raise exception '(stock_[a-z_]+)'/g)].map((m) => m[1]!));
    expect(codes.size).toBeGreaterThan(20);
    for (const c of codes) expect(traduireErreurStock({ message: c }).code, c).toBe(c);
  });
});
