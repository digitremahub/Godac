import { describe, expect, it } from "vitest";
import { ACRONYME, phraseAcronyme, sigleAcronyme } from "@/lib/vitrine/acronyme";
import { SEQUENCE_PAR_DEFAUT, etatGodac, peutRejouer, sequenceGodac } from "@/lib/vitrine/sequence-godac";
import { GLYPHES_GODAC } from "@/lib/vitrine/glyphes-godac";
import { raisonRepli } from "@/lib/vitrine/scene";

describe("acronyme GODAC", () => {
  it("se déploie en la phrase officielle", () => {
    expect(phraseAcronyme()).toBe("Gestion et Optimisation Des Actifs et Charges");
  });
  it("le sigle est GODAC et chaque lettre est l'initiale de son mot", () => {
    expect(sigleAcronyme()).toBe("GODAC");
    for (const { lettre, mot } of ACRONYME.lettres) expect(mot.startsWith(lettre)).toBe(true);
  });
  it("suit un remplacement des lettres (une seule constante à modifier)", () => {
    const autre = [
      { lettre: "G", mot: "Gestion" },
      { lettre: "O", mot: "Optimisation", liaison: "et" },
      { lettre: "D", mot: "Des" },
      { lettre: "A", mot: "Activités" },
      { lettre: "C", mot: "Connectées" },
    ];
    expect(phraseAcronyme(autre)).toBe("Gestion et Optimisation Des Activités Connectées");
  });
});

describe("sequenceGodac", () => {
  const s = sequenceGodac(5);

  it("prévoit une étape par lettre, dans l'ordre", () => {
    expect(s.etapes.map((e) => e.indice)).toEqual([0, 1, 2, 3, 4]);
  });
  it("échelonne l'arrivée des lettres", () => {
    expect(s.etapes.map((e) => e.delaiLettreMs)).toEqual([0, 130, 260, 390, 520]);
  });
  it("pose les points après l'assemblage complet, un par un, sans aucun mot", () => {
    const finLettres = 4 * SEQUENCE_PAR_DEFAUT.ecartLettreMs + SEQUENCE_PAR_DEFAUT.dureeLettreMs;
    expect(s.etapes[0]!.delaiNoeudMs).toBeGreaterThanOrEqual(finLettres);
    for (let i = 1; i < 5; i++) expect(s.etapes[i]!.delaiNoeudMs).toBeGreaterThan(s.etapes[i - 1]!.delaiNoeudMs);
    expect(Object.keys(s.etapes[0]!)).not.toContain("delaiMotMs");
  });
  it("relie chaque lettre à la suivante, sauf la dernière", () => {
    expect(s.etapes.slice(0, 4).every((e) => e.delaiTraitMs !== null)).toBe(true);
    expect(s.etapes[4]!.delaiTraitMs).toBeNull();
    expect(s.etapes[0]!.delaiTraitMs!).toBeGreaterThanOrEqual(s.etapes[0]!.delaiNoeudMs);
    expect(s.etapes[1]!.delaiTraitMs!).toBeGreaterThan(s.etapes[0]!.delaiTraitMs!);
  });
  it("chaque trait arrive quand le point suivant apparaît", () => {
    for (let i = 0; i < 4; i++) {
      expect(s.etapes[i]!.delaiTraitMs! + SEQUENCE_PAR_DEFAUT.dureeTraitMs).toBe(s.etapes[i + 1]!.delaiNoeudMs);
    }
  });
  it("la durée totale couvre le dernier point et le dernier trait", () => {
    const dernier = s.etapes[4]!;
    expect(s.dureeTotaleMs).toBe(dernier.delaiNoeudMs + SEQUENCE_PAR_DEFAUT.dureeNoeudMs);
    expect(s.dureeTotaleMs).toBeGreaterThanOrEqual(s.etapes[3]!.delaiTraitMs! + SEQUENCE_PAR_DEFAUT.dureeTraitMs);
  });
  it("gère zéro ou une lettre", () => {
    expect(sequenceGodac(0)).toEqual({ etapes: [], dureeTotaleMs: 0 });
    const une = sequenceGodac(1);
    expect(une.etapes).toHaveLength(1);
    expect(une.etapes[0]!.delaiTraitMs).toBeNull();
  });
});

describe("glyphes du logo GODAC", () => {
  it("fournit une lettre vectorielle par lettre du sigle, dans l'ordre", () => {
    expect(GLYPHES_GODAC.map((g) => g.lettre).join("")).toBe(sigleAcronyme());
  });
  it("garde les contre-formes de O et D (plusieurs sous-chemins) et un tracé fermé par lettre", () => {
    const sousChemins = (d: string) => (d.match(/M /g) ?? []).length;
    const parLettre = Object.fromEntries(GLYPHES_GODAC.map((g) => [g.lettre, sousChemins(g.d)]));
    expect(parLettre.O).toBe(2);
    expect(parLettre.D).toBe(2);
    for (const g of GLYPHES_GODAC) {
      expect(g.largeur).toBeGreaterThan(0);
      expect(g.d.startsWith("M ")).toBe(true);
    }
  });
  it("garde dans l'ordre les positions du logo (abscisses croissantes)", () => {
    for (let i = 1; i < GLYPHES_GODAC.length; i++) expect(GLYPHES_GODAC[i]!.x).toBeGreaterThan(GLYPHES_GODAC[i - 1]!.x);
  });
});

describe("repli de l'animation GODAC", () => {
  it("statique tant que l'animation n'est pas autorisée", () => {
    expect(etatGodac(false, false)).toBe("statique");
    expect(etatGodac(false, true)).toBe("statique");
  });
  it("attend l'entrée à l'écran, puis joue", () => {
    expect(etatGodac(true, false)).toBe("attente");
    expect(etatGodac(true, true)).toBe("joue");
  });
  it("reste statique pour les profils de repli de la scène (mouvement réduit, appareil modeste, économie de données)", () => {
    const profils = [
      { mouvementReduit: true, coeurs: 8 },
      { mouvementReduit: false, coeurs: 2 },
      { mouvementReduit: false, economieDonnees: true },
      { mouvementReduit: false, css3d: false },
    ];
    for (const env of profils) expect(etatGodac(raisonRepli(env) === null, true)).toBe("statique");
    expect(etatGodac(raisonRepli({ mouvementReduit: false, coeurs: 8 }) === null, true)).toBe("joue");
  });
  it("ne relance qu'une séquence terminée et autorisée", () => {
    const total = sequenceGodac(5).dureeTotaleMs;
    expect(peutRejouer(true, total, total)).toBe(true);
    expect(peutRejouer(true, total - 1, total)).toBe(false);
    expect(peutRejouer(true, null, total)).toBe(false);
    expect(peutRejouer(false, total * 2, total)).toBe(false);
  });
});
