import { describe, expect, it } from "vitest";
import { CLE_AVERTISSEMENT, MESSAGE_SAISIE_BLOQUEE, SEUIL_ARRET_KMH, SEUIL_MOUVEMENT_KMH, avertissementDejaVu, mouvementApres, saisieBloquee } from "@/lib/go-lieux/saisie";
import { readFileSync } from "node:fs";

describe("saisie bloquée en roulant (15 / 8 km/h)", () => {
  it("seuils 15 et 8 km/h, message imposé", () => {
    expect(SEUIL_MOUVEMENT_KMH).toBe(15);
    expect(SEUIL_ARRET_KMH).toBe(8);
    expect(MESSAGE_SAISIE_BLOQUEE).toBe("Arrêtez-vous pour saisir une destination");
  });
  it("bloque au-dessus de 15 km/h, débloque sous 8 km/h, garde l'état entre les deux", () => {
    let m = false;
    m = mouvementApres(m, 15);
    expect(m).toBe(false);
    m = mouvementApres(m, 16);
    expect(saisieBloquee(m)).toBe(true);
    m = mouvementApres(m, 10);
    expect(saisieBloquee(m)).toBe(true);
    m = mouvementApres(m, 7);
    expect(saisieBloquee(m)).toBe(false);
    expect(mouvementApres(true, null)).toBe(true);
    expect(mouvementApres(false, null)).toBe(false);
  });
  it("l'écran remplace la recherche et les saisies de nom par le message quand le véhicule roule", () => {
    const dest = readFileSync("components/go-aller-a/EcranDestination.tsx", "utf8");
    expect(dest).toMatch(/mouvement \? \(\s*<>\s*<input className="input" disabled/);
    expect(dest).toContain("MESSAGE_SAISIE_BLOQUEE");
    expect(dest).toMatch(/disabled=\{mouvement \|\| !renomme\.nom\.trim\(\)\}/);
    const fav = readFileSync("components/go-aller-a/EnregistrerFavori.tsx", "utf8");
    expect(fav).toContain("MESSAGE_SAISIE_BLOQUEE");
    expect(fav).toMatch(/disabled=\{envoi \|\| mouvement/);
  });
  it("l'avertissement d'usage prudent ne s'affiche qu'une fois", () => {
    expect(avertissementDejaVu(null)).toBe(false);
    expect(avertissementDejaVu("1")).toBe(true);
    const src = readFileSync("components/go-aller-a/AllerA.tsx", "utf8");
    expect(src).toContain(CLE_AVERTISSEMENT.length ? "CLE_AVERTISSEMENT" : "");
    expect(src).toMatch(/localStorage\.setItem\(CLE_AVERTISSEMENT, "1"\)/);
    expect(src).toContain('role="dialog"');
  });
});
