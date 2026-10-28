import { describe, expect, it } from "vitest";
import { calculerEcarts, emplacementsDeLaZone, phraseBilan, type UniteConnue } from "@/lib/stock/inventaire";

const SITE = "s1";
const Q1 = "zone-q1";
const A = "emp-a";
const B = "emp-b";
const AUTRE = "emp-autre-zone";
const u = (code: string, emplacement_id: string | null, statut: UniteConnue["statut"] = "dans_depot", site_id: string | null = SITE): UniteConnue => ({ code, statut, site_id, emplacement_id });
const perimetre = { site_id: SITE, emplacements: new Set([Q1, A, B]) };

describe("écarts d'inventaire des unités", () => {
  it("conforme, déplacée, trouvée hors stock, non retrouvée", () => {
    const b = calculerEcarts({
      perimetre,
      unitesConnues: [u("C1", A), u("C2", A), u("C3", B), u("C4", A), u("C5", AUTRE), u("L1", null, "livre"), u("E1", A, "en_tournee")],
      lignesUnites: [
        { code: "C1", emplacement_id: A }, // conforme
        { code: "C2", emplacement_id: B }, // déplacée
        { code: "L1", emplacement_id: A }, // livrée mais retrouvée au dépôt
        { code: "NEUF", emplacement_id: A }, // inconnue
      ],
      lignesArticles: [],
      soldes: [],
    });
    const genre = (code: string) => b.unites.find((x) => x.code === code)?.genre;
    expect(genre("C1")).toBe("conforme");
    expect(genre("C2")).toBe("deplacee");
    expect(genre("L1")).toBe("trouvee");
    expect(genre("NEUF")).toBe("trouvee");
    expect(genre("C3")).toBe("manquante");
    expect(genre("C4")).toBe("manquante");
    // Hors périmètre (autre zone) ou pas en stock (en tournée) : jamais déclarée manquante.
    expect(genre("C5")).toBeUndefined();
    expect(genre("E1")).toBeUndefined();
    expect(b.total).toBe(5);
  });

  it("une unité comptée sans emplacement précis est conforme si elle est en dépôt dans ce dépôt", () => {
    const b = calculerEcarts({ perimetre, unitesConnues: [u("C1", A)], lignesUnites: [{ code: "C1", emplacement_id: null }], lignesArticles: [], soldes: [] });
    expect(b.unites).toEqual([{ code: "C1", genre: "conforme" }]);
    expect(b.total).toBe(0);
  });

  it("une unité d'un autre dépôt comptée ici est « trouvée »", () => {
    const b = calculerEcarts({ perimetre, unitesConnues: [u("C1", A, "dans_depot", "autre-site")], lignesUnites: [{ code: "C1", emplacement_id: A }], lignesArticles: [], soldes: [] });
    expect(b.unites[0]!.genre).toBe("trouvee");
  });

  it("inventaire de tout le dépôt : une unité sans emplacement est aussi attendue", () => {
    const b = calculerEcarts({ perimetre: { site_id: SITE, emplacements: null }, unitesConnues: [u("C1", null), u("C2", AUTRE)], lignesUnites: [], lignesArticles: [], soldes: [] });
    expect(b.unites.map((x) => x.genre)).toEqual(["manquante", "manquante"]);
  });

  it("par zone : une unité sans emplacement n'est pas attendue", () => {
    const b = calculerEcarts({ perimetre, unitesConnues: [u("C1", null)], lignesUnites: [], lignesArticles: [], soldes: [] });
    expect(b.unites).toEqual([]);
  });
});

describe("écarts d'inventaire des articles", () => {
  const soldes = [
    { article_id: "a1", emplacement_id: A, lot: "", quantite: 10 },
    { article_id: "a1", emplacement_id: B, lot: "L1", quantite: 4 },
  ];
  it("compare le compté au solde du moment, par emplacement et par lot", () => {
    const b = calculerEcarts({
      perimetre,
      unitesConnues: [],
      lignesUnites: [],
      lignesArticles: [
        { article_id: "a1", emplacement_id: A, lot: "", quantite_comptee: 8 },
        { article_id: "a1", emplacement_id: B, lot: "L1", quantite_comptee: 4 },
        { article_id: "a2", emplacement_id: A, lot: "", quantite_comptee: 3 },
      ],
      soldes,
    });
    expect(b.articles.map((x) => x.ecart)).toEqual([-2, 0, 3]);
    expect(b.total).toBe(2);
  });
  it("une ligne pas encore comptée est ignorée (jamais mise à zéro)", () => {
    const b = calculerEcarts({ perimetre, unitesConnues: [], lignesUnites: [], lignesArticles: [{ article_id: "a1", emplacement_id: A, lot: "", quantite_comptee: null }], soldes });
    expect(b.articles).toEqual([]);
    expect(b.total).toBe(0);
  });
  it("les décimales ne créent pas de faux écart", () => {
    const b = calculerEcarts({ perimetre, unitesConnues: [], lignesUnites: [], lignesArticles: [{ article_id: "a1", emplacement_id: A, lot: "", quantite_comptee: 0.3 }], soldes: [{ article_id: "a1", emplacement_id: A, lot: "", quantite: 0.1 + 0.2 }] });
    expect(b.articles[0]!.ecart).toBe(0);
  });
});

describe("périmètre et bilan", () => {
  it("une zone et ses emplacements", () => {
    const tous = [
      { id: Q1, parent_id: null },
      { id: A, parent_id: Q1 },
      { id: "z2", parent_id: null },
      { id: AUTRE, parent_id: "z2" },
    ];
    expect([...emplacementsDeLaZone(Q1, tous)].sort()).toEqual([A, Q1].sort());
  });
  it("phrase de bilan", () => {
    expect(phraseBilan({ unites: [], articles: [], total: 0 })).toBe("Aucun écart : le stock correspond au comptage.");
    const b = calculerEcarts({ perimetre, unitesConnues: [u("C3", B)], lignesUnites: [{ code: "NEUF", emplacement_id: A }], lignesArticles: [{ article_id: "a", emplacement_id: A, lot: "", quantite_comptee: 2 }], soldes: [] });
    expect(phraseBilan(b)).toBe("3 écarts : 1 unité non retrouvée, 1 unité trouvée hors stock, 1 écart de quantité.");
  });
});
