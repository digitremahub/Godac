import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZXING_WASM_SHA256 } from "barcode-detector/ponyfill";
import { creerDetecteur, ZXING_WASM_URL } from "@/lib/colis/detecteur";

describe("lecteur ZXing servi par le site", () => {
  it("le binaire de public/ correspond à la version de barcode-detector installée", () => {
    const wasm = readFileSync(join(process.cwd(), "public", ZXING_WASM_URL));
    // Après une mise à jour de barcode-detector : recopier
    // node_modules/zxing-wasm/dist/reader/zxing_reader.wasm dans public/zxing/.
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(ZXING_WASM_SHA256);
  });
});

describe("choix du détecteur", () => {
  const g = globalThis as { BarcodeDetector?: unknown };
  afterEach(() => {
    delete g.BarcodeDetector;
  });

  function natif(supportes: string[]) {
    const crees: string[][] = [];
    g.BarcodeDetector = class {
      static getSupportedFormats = async () => supportes;
      constructor(o: { formats: string[] }) {
        crees.push(o.formats);
      }
      detect = async () => [];
    };
    return crees;
  }

  it("garde le natif complet, limité aux formats qu'il lit", async () => {
    const crees = natif(["qr_code", "code_128", "data_matrix", "ean_13"]);
    await creerDetecteur();
    expect(crees).toEqual([["qr_code", "data_matrix", "code_128", "ean_13"]]);
  });

  it("écarte un natif qui ne lit que les QR codes", async () => {
    const crees = natif(["qr_code"]);
    await creerDetecteur();
    expect(crees).toEqual([]);
  });
});
