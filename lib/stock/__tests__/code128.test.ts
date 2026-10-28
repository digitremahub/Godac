import { describe, expect, it } from "vitest";
import {
  ARRET,
  CODE_B,
  CODE_C,
  DEPART_B,
  DEPART_C,
  MOTIFS_CODE128,
  ZONE_SILENCE_MODULES,
  barresCode128,
  controleCode128,
  decoderSymboles,
  encodable128,
  encoderCode128,
  modulesDeSymboles,
  symbolesCode128,
} from "@/lib/stock/code128";

const somme = (motif: string) => [...motif].reduce((n, c) => n + Number(c), 0);

describe("table des symboles Code 128", () => {
  it("107 symboles : 106 de 6 éléments sur 11 modules, l'arrêt de 7 éléments sur 13 modules", () => {
    expect(MOTIFS_CODE128).toHaveLength(107);
    MOTIFS_CODE128.slice(0, 106).forEach((m, i) => {
      expect(m, `symbole ${i}`).toHaveLength(6);
      expect(somme(m), `symbole ${i}`).toBe(11);
    });
    expect(MOTIFS_CODE128[106]).toBe("2331112");
    expect(somme(MOTIFS_CODE128[106]!)).toBe(13);
  });
  it("tous les motifs sont distincts et chaque largeur est de 1 à 4 modules", () => {
    expect(new Set(MOTIFS_CODE128).size).toBe(107);
    for (const m of MOTIFS_CODE128) for (const c of m) expect(Number(c)).toBeGreaterThanOrEqual(1), expect(Number(c)).toBeLessThanOrEqual(4);
  });
  it("symboles de référence : départ B, départ C, changements de jeu, arrêt", () => {
    expect(modulesDeSymboles([DEPART_B])).toBe("11010010000");
    expect(modulesDeSymboles([DEPART_C])).toBe("11010011100");
    expect(modulesDeSymboles([0])).toBe("11011001100");
    expect(modulesDeSymboles([CODE_C])).toBe("10111011110");
    expect(modulesDeSymboles([CODE_B])).toBe("10111101110");
    expect(modulesDeSymboles([ARRET])).toBe("1100011101011");
  });
});

describe("somme de contrôle (modulo 103)", () => {
  it("vecteur de référence : « PJJ123C » en jeu A (départ 103) a pour contrôle 54", () => {
    // P=48, J=42, J=42, 1=17, 2=18, 3=19, C=35 (valeur = ASCII - 32, identique en jeux A et B)
    expect(controleCode128([103, 48, 42, 42, 17, 18, 19, 35])).toBe(54);
  });
  it("même texte en jeu B (départ 104) : 55", () => {
    expect(controleCode128([DEPART_B, 48, 42, 42, 17, 18, 19, 35])).toBe(55);
  });
  it("jeu C : « 1234 » = départ 105, 12, 34 → (105 + 12 + 2 × 34) mod 103 = 82", () => {
    expect(controleCode128([DEPART_C, 12, 34])).toBe(82);
  });
  it("jeu B : « Hello » → 76", () => {
    expect(controleCode128([DEPART_B, 40, 69, 76, 76, 79])).toBe(76);
  });
});

describe("encodage", () => {
  it("« A » : départ B, A, contrôle 34, arrêt (suite de modules complète)", () => {
    const c = encoderCode128("A");
    expect(c.symboles).toEqual([104, 33, 34, 106]);
    expect(c.controle).toBe(34);
    expect(c.modules).toBe("11010010000" + "10100011000" + "10001011000" + "1100011101011");
    expect(c.depart).toBe("B");
  });
  it("« 1234 » démarre en jeu C : 2 symboles de données", () => {
    const c = encoderCode128("1234");
    expect(c.symboles).toEqual([DEPART_C, 12, 34, 82, ARRET]);
    expect(c.depart).toBe("C");
  });
  it("« 12 » : une seule paire en jeu C", () => {
    expect(encoderCode128("12").symboles.slice(0, 2)).toEqual([DEPART_C, 12]);
  });
  it("passage en C rentable : huit chiffres ou plus au milieu d'un texte", () => {
    expect(symbolesCode128("AB12345678CD")).toEqual([DEPART_B, 33, 34, CODE_C, 12, 34, 56, 78, CODE_B, 35, 36]);
  });
  it("chiffres en nombre impair : le premier chiffre part en jeu B, la suite en C", () => {
    const s = symbolesCode128("12345");
    expect(s).toEqual([DEPART_B, 17, CODE_C, 23, 45]);
  });
  it("code interne : B pour le préfixe et l'année (passer en C ne gagne rien), C pour le compteur à 6 chiffres", () => {
    const c = encoderCode128("TRA-2026-000012");
    expect(c.symboles.slice(0, -2)).toEqual([104, 52, 50, 33, 13, 18, 16, 18, 22, 13, CODE_C, 0, 0, 12]);
    // (104 + 1×52 + 2×50 + 3×33 + 4×13 + 5×18 + 6×16 + 7×18 + 8×22 + 9×13 + 10×99 + 13×12) mod 103
    expect(c.controle).toBe(2158 % 103);
    expect(c.controle).toBe(98);
    expect(c.symboles.at(-1)).toBe(ARRET);
  });
  it("SSCC de 18 chiffres : 9 paires en jeu C seulement", () => {
    const c = encoderCode128("003456789012345678");
    expect(c.depart).toBe("C");
    expect(c.symboles).toHaveLength(1 + 9 + 1 + 1);
  });
  it("jeu B pour les lettres minuscules et la ponctuation", () => {
    expect(symbolesCode128("a-b_c ~")).toEqual([DEPART_B, 65, 13, 66, 63, 67, 0, 94]);
  });
  it("longueur du code : 11 modules par symbole + 2 de l'arrêt", () => {
    const c = encoderCode128("TRA-2026-000012");
    expect(c.modules).toHaveLength((c.symboles.length - 1) * 11 + 13);
    expect(c.largeurModules).toBe(c.modules.length + 2 * ZONE_SILENCE_MODULES);
  });
  it("le texte se relit à l'identique (aller-retour sur des codes variés)", () => {
    for (const t of ["A", "12", "123", "1234", "TRA-2026-000001", "003456789012345678", "COLIS 42/B", "a1b2c3", "0000", "9", "x1234y56789z", "~~~~", " ", "AB12CD34EF56"]) {
      const c = encoderCode128(t);
      expect(decoderSymboles(c.symboles), t).toBe(t);
    }
  });
  it("aller-retour sur 300 chaînes pseudo-aléatoires (jeux B et C mêlés)", () => {
    let graine = 12345;
    const alea = () => ((graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = "0123456789012345678901234567890123456789ABCDEF-/ .";
    for (let k = 0; k < 300; k++) {
      const n = 1 + Math.floor(alea() * 30);
      let t = "";
      for (let i = 0; i < n; i++) t += alphabet[Math.floor(alea() * alphabet.length)];
      expect(decoderSymboles(encoderCode128(t).symboles), t).toBe(t);
    }
  });
  it("le découpage est minimal (jamais plus long que le jeu B seul)", () => {
    for (const t of ["TRA-2026-000012", "00000000", "A1234567B", "12345678901234567890"]) {
      expect(symbolesCode128(t).length).toBeLessThanOrEqual(1 + t.length);
    }
  });
  it("refuse ce que le Code 128 B ne représente pas", () => {
    for (const t of ["", "é", "a\tb", "日本", "x".repeat(81)]) {
      expect(encodable128(t), JSON.stringify(t)).toBe(false);
      expect(() => encoderCode128(t)).toThrow();
    }
    expect(encodable128("x".repeat(80))).toBe(true);
  });
  it("décodage : refuse un contrôle faux ou un arrêt manquant", () => {
    const s = encoderCode128("TRA-1").symboles;
    expect(() => decoderSymboles([...s.slice(0, -2), (s.at(-2)! + 1) % 103, ARRET])).toThrow(/contrôle/);
    expect(() => decoderSymboles(s.slice(0, -1))).toThrow();
    expect(() => decoderSymboles([1, 2, 3])).toThrow();
  });
});

describe("barres et zone de silence", () => {
  it("la zone de silence est de 10 modules de chaque côté", () => {
    const c = encoderCode128("A");
    const barres = barresCode128(c);
    expect(barres[0]!.x).toBe(ZONE_SILENCE_MODULES);
    const derniere = barres.at(-1)!;
    expect(derniere.x + derniere.largeur).toBe(ZONE_SILENCE_MODULES + c.modules.length);
    expect(c.largeurModules - (derniere.x + derniere.largeur)).toBe(ZONE_SILENCE_MODULES);
  });
  it("les barres reconstituent exactement les modules", () => {
    const c = encoderCode128("TRA-2026-000012");
    const rebuilt = new Array(c.modules.length).fill("0");
    for (const b of barresCode128(c)) for (let i = 0; i < b.largeur; i++) rebuilt[b.x - ZONE_SILENCE_MODULES + i] = "1";
    expect(rebuilt.join("")).toBe(c.modules);
  });
  it("aucune barre ne dépasse 4 modules et les barres ne se touchent pas", () => {
    const barres = barresCode128(encoderCode128("COLIS-0042/B"));
    for (let i = 0; i < barres.length; i++) {
      expect(barres[i]!.largeur).toBeLessThanOrEqual(4);
      if (i > 0) expect(barres[i]!.x).toBeGreaterThan(barres[i - 1]!.x + barres[i - 1]!.largeur - 1);
    }
  });
  it("commence et finit par une barre (départ et arrêt)", () => {
    const c = encoderCode128("42");
    expect(c.modules.startsWith("11")).toBe(true);
    expect(c.modules.endsWith("11")).toBe(true);
  });
});

describe("relecture des modules (décodeur indépendant de l'encodeur)", () => {
  const parBits = new Map(MOTIFS_CODE128.map((_, i) => [modulesDeSymboles([i]), i]));
  /** Découpe la suite de modules en symboles de 11 modules puis l'arrêt de 13. */
  function lire(modules: string): number[] {
    const sortie: number[] = [];
    let i = 0;
    while (i < modules.length - 13) {
      const v = parBits.get(modules.slice(i, i + 11));
      if (v === undefined) throw new Error(`motif inconnu en ${i}`);
      sortie.push(v);
      i += 11;
    }
    expect(modules.slice(i)).toBe("1100011101011");
    return [...sortie, ARRET];
  }
  it("les modules d'un code relus symbole par symbole redonnent le texte", () => {
    for (const t of ["TRA-2026-000012", "003456789012345678", "COLIS 42/B", "A"]) {
      const c = encoderCode128(t);
      const relus = lire(c.modules);
      expect(relus).toEqual(c.symboles);
      expect(decoderSymboles(relus)).toBe(t);
    }
  });
  it("la table n'a aucune collision : 107 suites de modules distinctes", () => {
    expect(parBits.size).toBe(107);
  });
});
