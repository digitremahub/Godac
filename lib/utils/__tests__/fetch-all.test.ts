import { describe, expect, it } from "vitest";
import { fetchAllRows } from "../fetch-all";

const table = Array.from({ length: 25 }, (_, i) => i);
const fake = (from: number, to: number) => Promise.resolve({ data: table.slice(from, to + 1), error: null });

describe("fetchAllRows", () => {
  it("enchaîne les pages jusqu'à la dernière", async () => {
    expect(await fetchAllRows(fake, { pageSize: 10 })).toEqual({ rows: table, truncated: false, error: null });
  });

  it("signale la troncature au-delà du plafond", async () => {
    const res = await fetchAllRows(fake, { pageSize: 10, maxRows: 20 });
    expect(res.rows).toHaveLength(20);
    expect(res.truncated).toBe(true);
  });

  it("remonte l'erreur", async () => {
    const res = await fetchAllRows(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    expect(res.error).toBe("boom");
  });
});
