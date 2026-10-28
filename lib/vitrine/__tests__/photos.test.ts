import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(__dirname, "../../..");
const DOSSIER = join(RACINE, "public/photos");

describe("photographies de la vitrine", () => {
  const fichiers = readdirSync(DOSSIER);

  it("n'autorise que des fichiers .webp dans public/photos", () => {
    expect(fichiers.length).toBe(7);
    for (const f of fichiers) expect(f).toMatch(/^[a-z-]+\.webp$/);
  });

  it("pèse moins de 1 Mo au total", () => {
    const total = fichiers.reduce((n, f) => n + statSync(join(DOSSIER, f)).size, 0);
    expect(total).toBeLessThan(1_000_000);
  });

  it("chaque photo référencée par le composant existe", () => {
    const src = readFileSync(join(RACINE, "components/marketing/PhotoVitrine.tsx"), "utf8");
    const chemins = [...src.matchAll(/"\/photos\/([a-z-]+\.webp)"/g)].map((m) => m[1]);
    expect(chemins.sort()).toEqual([...fichiers].sort());
  });

  it("chaque emploi dans la vitrine a un texte alternatif descriptif, en différé", () => {
    const src = readFileSync(join(RACINE, "components/marketing/PhotoVitrine.tsx"), "utf8");
    expect(src).toContain('loading="lazy"');
    for (const f of ["app/page.tsx", "components/marketing/SectionsAccueil.tsx"]) {
      const code = readFileSync(join(RACINE, f), "utf8");
      for (const m of code.matchAll(/<PhotoVitrine[\s\S]*?\/>/g)) {
        const alt = /alt="([^"]+)"/.exec(m[0])?.[1] ?? "";
        expect(alt.length).toBeGreaterThan(30);
        expect(m[0]).toContain("sizes=");
      }
    }
  });
});
