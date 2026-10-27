import { describe, expect, it } from "vitest";
import { ACTION_ACCUSE_INDICATIF, MENTION_INDICATIVE, VERSION_MENTION_INDICATIVE } from "@/lib/legal/mention-indicative";
import { AVERTISSEMENT_TICPE } from "@/lib/ticpe/reglages";
import { readFileSync } from "node:fs";
import { csvPleins } from "@/lib/fuel/export";

describe("mention « document indicatif »", () => {
  it("texte exact demandé, repris partout", () => {
    expect(MENTION_INDICATIVE).toBe(
      "Document établi à titre indicatif par GODAC à partir des paramètres de l'entreprise. À faire vérifier par votre expert-comptable / responsable paie avant tout usage déclaratif.",
    );
    expect(AVERTISSEMENT_TICPE).toBe(MENTION_INDICATIVE);
    expect(csvPleins([])).toContain(MENTION_INDICATIVE);
  });
  it("l'accusé de lecture est une action du journal d'audit existant (pas de table dédiée)", () => {
    expect(readFileSync("lib/audit/journal.ts", "utf8")).toContain(`${ACTION_ACCUSE_INDICATIF}:`);
    expect(VERSION_MENTION_INDICATIVE).toMatch(/^\d+$/);
  });
});
