import { describe, expect, it } from "vitest";
import { crc32, creerZip, nomsUniques } from "@/lib/paie/zip";

describe("archive ZIP", () => {
  it("CRC-32 de référence", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("structure : en-têtes local, central et fin", () => {
    const zip = creerZip([
      { nom: "a.txt", contenu: "bonjour", date: new Date(2026, 9, 21, 10, 0, 0) },
      { nom: "Bulletin 2026-09 - Exemple.pdf", contenu: new Uint8Array([1, 2, 3]) },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const fin = zip.length - 22;
    expect(v.getUint32(fin, true)).toBe(0x06054b50);
    expect(v.getUint16(fin + 10, true)).toBe(2);
    const debutCentral = v.getUint32(fin + 16, true);
    expect(v.getUint32(debutCentral, true)).toBe(0x02014b50);
    // Contenu stocké tel quel.
    expect(new TextDecoder().decode(zip.slice(30 + 5, 30 + 5 + 7))).toBe("bonjour");
  });

  it("noms en double renommés", () => {
    expect(nomsUniques(["a.pdf", "a.pdf", "b", "b"])).toEqual(["a.pdf", "a (2).pdf", "b", "b (2)"]);
  });
});
