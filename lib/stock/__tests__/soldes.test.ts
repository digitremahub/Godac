import { describe, expect, it } from "vitest";
import { appliquerMouvement, articlesSousSeuil, formaterQuantite, joursAvantDlc, resumerUnites, totalArticle, type MouvementArticle, type Solde } from "@/lib/stock/soldes";

const A = "art-1";
const S = "site-1";
const E1 = "emp-1";
const E2 = "emp-2";
const mv = (m: Partial<MouvementArticle> & Pick<MouvementArticle, "type" | "quantite">): MouvementArticle => ({ article_id: A, site_id: S, ...m });
const appliquer = (soldes: Solde[], m: MouvementArticle) => {
  const r = appliquerMouvement(soldes, m);
  if (!r.ok) throw new Error(r.erreur);
  return r.soldes;
};

describe("soldes d'articles", () => {
  it("entrée puis sortie : le solde suit, sans jamais devenir négatif", () => {
    let s: Solde[] = [];
    s = appliquer(s, mv({ type: "entree", quantite: 12, emplacement_dest_id: E1 }));
    expect(totalArticle(s, A)).toBe(12);
    s = appliquer(s, mv({ type: "sortie", quantite: 5, emplacement_source_id: E1 }));
    expect(totalArticle(s, A)).toBe(7);
    expect(appliquerMouvement(s, mv({ type: "sortie", quantite: 50, emplacement_source_id: E1 }))).toEqual({ ok: false, erreur: "stock_insuffisant" });
    expect(totalArticle(s, A)).toBe(7);
  });

  it("une sortie d'un emplacement vide est refusée même si l'article existe ailleurs", () => {
    const s = appliquer([], mv({ type: "entree", quantite: 10, emplacement_dest_id: E1 }));
    expect(appliquerMouvement(s, mv({ type: "sortie", quantite: 1, emplacement_source_id: E2 }))).toEqual({ ok: false, erreur: "stock_insuffisant" });
  });

  it("transfert : le total ne change pas, les emplacements oui", () => {
    let s = appliquer([], mv({ type: "entree", quantite: 10, emplacement_dest_id: E1 }));
    s = appliquer(s, mv({ type: "transfert", quantite: 4, emplacement_source_id: E1, emplacement_dest_id: E2 }));
    expect(totalArticle(s, A)).toBe(10);
    expect(s.find((x) => x.emplacement_id === E1)?.quantite).toBe(6);
    expect(s.find((x) => x.emplacement_id === E2)?.quantite).toBe(4);
    expect(appliquerMouvement(s, mv({ type: "transfert", quantite: 1, emplacement_source_id: E1, emplacement_dest_id: E1 }))).toEqual({ ok: false, erreur: "stock_transfert_identique" });
  });

  it("casse et perte retirent ; retour ajoute ; ajustement suit son sens", () => {
    let s = appliquer([], mv({ type: "entree", quantite: 10, emplacement_dest_id: E1 }));
    s = appliquer(s, mv({ type: "casse", quantite: 2, emplacement_source_id: E1 }));
    s = appliquer(s, mv({ type: "perte", quantite: 1, emplacement_source_id: E1 }));
    s = appliquer(s, mv({ type: "retour", quantite: 3, emplacement_dest_id: E1 }));
    expect(totalArticle(s, A)).toBe(10);
    s = appliquer(s, mv({ type: "ajustement", sens: -1, quantite: 4, emplacement_source_id: E1 }));
    s = appliquer(s, mv({ type: "ajustement", sens: 1, quantite: 1, emplacement_dest_id: E1 }));
    expect(totalArticle(s, A)).toBe(7);
    expect(appliquerMouvement(s, mv({ type: "ajustement", quantite: 1 }))).toEqual({ ok: false, erreur: "stock_sens_invalide" });
  });

  it("lots séparés : un lot ne couvre pas la sortie d'un autre", () => {
    let s = appliquer([], mv({ type: "entree", quantite: 5, lot: "L1", dlc: "2027-01-01", emplacement_dest_id: E1 }));
    s = appliquer(s, mv({ type: "entree", quantite: 5, lot: "L2", emplacement_dest_id: E1 }));
    expect(s).toHaveLength(2);
    expect(appliquerMouvement(s, mv({ type: "sortie", quantite: 6, lot: "L1", emplacement_source_id: E1 }))).toEqual({ ok: false, erreur: "stock_insuffisant" });
    s = appliquer(s, mv({ type: "sortie", quantite: 5, lot: "L1", emplacement_source_id: E1 }));
    expect(s.find((x) => x.lot === "L1")?.quantite).toBe(0);
  });

  it("la DLC du lot suit un transfert", () => {
    let s = appliquer([], mv({ type: "entree", quantite: 5, lot: "L1", dlc: "2027-01-01", emplacement_dest_id: E1 }));
    s = appliquer(s, mv({ type: "transfert", quantite: 2, lot: "L1", emplacement_source_id: E1, emplacement_dest_id: E2 }));
    expect(s.find((x) => x.emplacement_id === E2)?.dlc).toBe("2027-01-01");
  });

  it("quantité nulle ou négative refusée ; la liste d'origine n'est pas modifiée", () => {
    const origine: Solde[] = [{ article_id: A, site_id: S, emplacement_id: E1, lot: "", quantite: 3 }];
    expect(appliquerMouvement(origine, mv({ type: "entree", quantite: 0 }))).toEqual({ ok: false, erreur: "stock_quantite_invalide" });
    appliquer(origine, mv({ type: "entree", quantite: 2, emplacement_dest_id: E1 }));
    expect(origine[0]!.quantite).toBe(3);
  });

  it("les quantités décimales restent exactes au millième", () => {
    let s = appliquer([], mv({ type: "entree", quantite: 0.1, emplacement_dest_id: E1 }));
    s = appliquer(s, mv({ type: "entree", quantite: 0.2, emplacement_dest_id: E1 }));
    expect(totalArticle(s, A)).toBe(0.3);
  });
});

describe("seuils mini", () => {
  const articles = [
    { id: "a", code: "A", nom: "Vis", unite: "pièce", seuil_mini: 10, actif: true },
    { id: "b", code: "B", nom: "Écrous", unite: "pièce", seuil_mini: 5, actif: true },
    { id: "c", code: "C", nom: "Rondelles", unite: "pièce", seuil_mini: 0, actif: true },
    { id: "d", code: "D", nom: "Boulons", unite: "pièce", seuil_mini: 50, actif: false },
  ];
  const soldes: Solde[] = [
    { article_id: "a", site_id: S, emplacement_id: E1, lot: "", quantite: 4 },
    { article_id: "a", site_id: "site-2", emplacement_id: null, lot: "", quantite: 3 },
    { article_id: "b", site_id: S, emplacement_id: E1, lot: "", quantite: 5 },
  ];
  it("compte tous les dépôts ; égal au seuil n'est pas « sous » le seuil ; sans seuil ou inactif : ignoré", () => {
    const r = articlesSousSeuil(articles, soldes);
    expect(r.map((x) => x.article.id)).toEqual(["a"]);
    expect(r[0]).toMatchObject({ quantite: 7, manque: 3 });
  });
  it("un article sans aucun solde est à zéro, trié par manque décroissant", () => {
    const r = articlesSousSeuil(articles, []);
    expect(r.map((x) => x.article.id)).toEqual(["a", "b"]);
    expect(r[0]!.quantite).toBe(0);
  });
});

describe("tableau de bord", () => {
  it("dénombre les unités par statut", () => {
    const r = resumerUnites([{ statut: "dans_depot" }, { statut: "dans_depot" }, { statut: "en_tournee" }, { statut: "retour" }, { statut: "livre" }, { statut: "perdu" }, { statut: "endommage" }]);
    expect(r).toEqual({ dansDepot: 2, enTournee: 1, retours: 1, livres: 1, perdus: 1, endommages: 1, auDepot: 3 });
  });
  it("jours avant DLC", () => {
    expect(joursAvantDlc("2026-11-10", "2026-10-28")).toBe(13);
    expect(joursAvantDlc("2026-10-20", "2026-10-28")).toBe(-8);
    expect(joursAvantDlc(null, "2026-10-28")).toBeNull();
  });
  it("quantité à la française", () => {
    expect(formaterQuantite(12)).toBe("12");
    expect(formaterQuantite(12.5)).toBe("12,5");
  });
});
