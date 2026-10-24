import { describe, expect, it } from "vitest";
import { creerSuiviAppel } from "@/lib/colis/suivi-appel";

describe("proposition « Eu au téléphone » après un appel", () => {
  it("propose l'arrêt appelé au retour dans l'application, une seule fois", () => {
    let t = 0;
    const suivi = creerSuiviAppel(() => t);
    suivi.lancer("a");
    suivi.aQuitte();
    t = 45_000;
    expect(suivi.auRetour()).toBe("a");
    expect(suivi.auRetour()).toBeNull();
  });
  it("rien tant que l'application n'a pas quitté l'écran (appel non ouvert)", () => {
    let t = 0;
    const suivi = creerSuiviAppel(() => t);
    suivi.lancer("a");
    t = 60_000;
    expect(suivi.auRetour()).toBeNull();
  });
  it("retour immédiat (< 2 s) ignoré, puis proposé au vrai retour", () => {
    let t = 0;
    const suivi = creerSuiviAppel(() => t);
    suivi.lancer("a");
    suivi.aQuitte();
    t = 500;
    expect(suivi.auRetour()).toBeNull();
    t = 30_000;
    expect(suivi.auRetour()).toBe("a");
  });
  it("oublié après 2 h ; le dernier appel remplace le précédent", () => {
    let t = 0;
    const suivi = creerSuiviAppel(() => t);
    suivi.lancer("a");
    suivi.aQuitte();
    t = 3 * 3_600_000;
    expect(suivi.auRetour()).toBeNull();
    suivi.lancer("b");
    suivi.lancer("c");
    suivi.aQuitte();
    t += 20_000;
    expect(suivi.auRetour()).toBe("c");
  });
});
