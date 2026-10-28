import { describe, expect, it } from "vitest";
import { cheminQr, matriceQr, tailleTotaleQr, ZONE_SILENCE_QR } from "@/lib/stock/qr";

describe("QR code vectoriel", () => {
  it("matrice carrée de modules, taille d'une version QR (4n + 17)", () => {
    const m = matriceQr("TRA-2026-000042");
    expect(m.lignes).toHaveLength(m.taille);
    expect(m.lignes.every((l) => l.length === m.taille)).toBe(true);
    expect((m.taille - 17) % 4).toBe(0);
    expect(m.taille).toBeGreaterThanOrEqual(21);
  });
  it("motifs de repérage : les trois coins ont le carré 7 × 7 plein sur le bord", () => {
    const m = matriceQr("TRA-2026-000042");
    const n = m.taille;
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      for (let i = 0; i < 7; i++) {
        expect(m.lignes[r0]![c0 + i], "bord haut").toBe(true);
        expect(m.lignes[r0 + 6]![c0 + i], "bord bas").toBe(true);
        expect(m.lignes[r0 + i]![c0], "bord gauche").toBe(true);
        expect(m.lignes[r0 + i]![c0 + 6], "bord droit").toBe(true);
      }
      expect(m.lignes[r0 + 3]![c0 + 3], "centre").toBe(true);
      expect(m.lignes[r0 + 1]![c0 + 1], "anneau clair").toBe(false);
    }
  });
  it("le même code donne le même QR, un autre code un autre QR", () => {
    expect(cheminQr(matriceQr("TRA-2026-000042"))).toBe(cheminQr(matriceQr("TRA-2026-000042")));
    expect(cheminQr(matriceQr("TRA-2026-000042"))).not.toBe(cheminQr(matriceQr("TRA-2026-000043")));
  });
  it("zone de silence de 4 modules : le chemin ne dessine rien dans la marge", () => {
    const m = matriceQr("COLIS-1");
    const total = tailleTotaleQr(m);
    expect(total).toBe(m.taille + 2 * ZONE_SILENCE_QR);
    const nombres = [...cheminQr(m).matchAll(/M(\d+) (\d+)h(\d+)v1/g)].map((x) => ({ x: Number(x[1]), y: Number(x[2]), w: Number(x[3]) }));
    expect(nombres.length).toBeGreaterThan(20);
    for (const s of nombres) {
      expect(s.x).toBeGreaterThanOrEqual(ZONE_SILENCE_QR);
      expect(s.y).toBeGreaterThanOrEqual(ZONE_SILENCE_QR);
      expect(s.x + s.w).toBeLessThanOrEqual(total - ZONE_SILENCE_QR);
      expect(s.y).toBeLessThan(total - ZONE_SILENCE_QR);
    }
  });
  it("le chemin couvre exactement les modules sombres", () => {
    const m = matriceQr("TRA-2026-000042");
    const sombres = m.lignes.flat().filter(Boolean).length;
    const couverts = [...cheminQr(m).matchAll(/h(\d+)v1/g)].reduce((n, x) => n + Number(x[1]), 0);
    expect(couverts).toBe(sombres);
  });
  it("un code interne ou un SSCC s'encode (jusqu'à 80 caractères)", () => {
    expect(matriceQr("003456789012345678").taille).toBeGreaterThanOrEqual(21);
    expect(matriceQr("A".repeat(80)).taille).toBeGreaterThan(matriceQr("A").taille);
  });
});
