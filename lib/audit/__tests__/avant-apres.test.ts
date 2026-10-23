import { describe, expect, it } from "vitest";
import { aucunChangement, avantApres } from "@/lib/audit/avant-apres";

describe("avant / après d'une modification", () => {
  it("ne garde que les champs changés, avec ancienne et nouvelle valeur", () => {
    const d = avantApres({ liters: 300, station_name: "Lyon", product: "gazole" }, { liters: 250, station_name: "Lyon" });
    expect(d).toEqual({ avant: { liters: 300 }, apres: { liters: 250 } });
    expect(aucunChangement(d)).toBe(false);
  });
  it("nombres lus en texte (« 300.00 ») ou en nombre : pas de faux changement", () => {
    expect(aucunChangement(avantApres({ liters: "300.00" }, { liters: 300 }))).toBe(true);
    expect(aucunChangement(avantApres({ liters: 300 }, { liters: "300" }))).toBe(true);
  });
  it("null, undefined et chaîne vide sont la même absence de valeur", () => {
    expect(aucunChangement(avantApres({ ticpe_zone: null }, { ticpe_zone: null }))).toBe(true);
    expect(aucunChangement(avantApres({}, { ticpe_zone: null }))).toBe(true);
    expect(avantApres({ ticpe_zone: null }, { ticpe_zone: "corse" })).toEqual({ avant: { ticpe_zone: null }, apres: { ticpe_zone: "corse" } });
    expect(avantApres({ ticpe_zone: "corse" }, { ticpe_zone: null })).toEqual({ avant: { ticpe_zone: "corse" }, apres: { ticpe_zone: null } });
  });
  it("état d'avant illisible : tout est consigné, avec avant à null", () => {
    expect(avantApres(null, { liters: 10 })).toEqual({ avant: { liters: null }, apres: { liters: 10 } });
  });
  it("0 n'est pas une absence", () => {
    expect(avantApres({ liters: null }, { liters: 0 })).toEqual({ avant: { liters: null }, apres: { liters: 0 } });
    expect(aucunChangement(avantApres({ liters: 0 }, { liters: "0" }))).toBe(true);
  });
  it("objets comparés par contenu", () => {
    expect(aucunChangement(avantApres({ a: { x: 1 } }, { a: { x: 1 } }))).toBe(true);
    expect(aucunChangement(avantApres({ a: { x: 1 } }, { a: { x: 2 } }))).toBe(false);
  });
});
