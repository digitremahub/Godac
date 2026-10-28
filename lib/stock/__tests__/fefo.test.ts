import { describe, expect, it } from "vitest";
import { lotsDlcProches, phraseFefo, profilDeLArticle, suggestionFefo, triFefo, unitesDlcProches } from "@/lib/stock/fefo";
import { cleAlerteDlc, decisionsDlc, messageDlcLot, messageDlcUnites } from "@/lib/stock/alertes";
import type { ProfilsConfig } from "@/lib/stock/profils";
import type { Solde } from "@/lib/stock/soldes";

const solde = (p: Partial<Solde> & { lot: string }): Solde => ({ article_id: "a1", site_id: "s1", emplacement_id: null, dlc: null, quantite: 5, ...p });

describe("FEFO : le lot le plus proche de sa DLC sort en premier", () => {
  const soldes: Solde[] = [solde({ lot: "L3", dlc: "2026-12-30" }), solde({ lot: "L1", dlc: "2026-11-05" }), solde({ lot: "L2", dlc: "2026-11-20" }), solde({ lot: "SANS" }), solde({ lot: "VIDE", dlc: "2026-10-01", quantite: 0 })];
  it("tri par DLC croissante, sans DLC en dernier, lots vides ignorés", () => {
    expect(triFefo(soldes).map((s) => s.lot)).toEqual(["L1", "L2", "L3", "SANS"]);
  });
  it("suggestion : le premier lot ayant une DLC", () => {
    expect(suggestionFefo(soldes, "a1")?.lot).toBe("L1");
    expect(suggestionFefo(soldes, "a1", "s1")?.lot).toBe("L1");
  });
  it("aucune suggestion sans DLC, pour un autre article ou un autre dépôt", () => {
    expect(suggestionFefo([solde({ lot: "X" })], "a1")).toBeNull();
    expect(suggestionFefo(soldes, "autre")).toBeNull();
    expect(suggestionFefo(soldes, "a1", "s2")).toBeNull();
  });
  it("à DLC égale, l'ordre des lots est stable", () => {
    expect(triFefo([solde({ lot: "B", dlc: "2026-11-05" }), solde({ lot: "A", dlc: "2026-11-05" })]).map((s) => s.lot)).toEqual(["A", "B"]);
  });
  it("une DLC dépassée passe en premier (à sortir ou à écarter)", () => {
    expect(triFefo([solde({ lot: "NEUF", dlc: "2027-01-01" }), solde({ lot: "PERIME", dlc: "2026-10-01" })])[0]!.lot).toBe("PERIME");
  });
  it("phrase d'aide, sans obligation", () => {
    expect(phraseFefo(solde({ lot: "L1", dlc: "2026-11-05" }), "2026-10-28")).toBe("Suggestion FEFO : sortir d'abord le lot L1, DLC 05/11/2026 (dans 8 j).");
    expect(phraseFefo(solde({ lot: "", dlc: "2026-10-20" }), "2026-10-28")).toMatch(/sans numéro de lot.*dépassée de 8 j/);
    expect(phraseFefo(solde({ lot: "L", dlc: "2026-10-28" }), "2026-10-28")).toMatch(/aujourd'hui/);
  });
});

describe("profil d'un article", () => {
  it("le sien s'il est actif, sinon le premier profil d'articles actif", () => {
    expect(profilDeLArticle({ profil: "pharmacie" }, ["pharmacie", "alimentaire"], null)?.cle).toBe("pharmacie");
    expect(profilDeLArticle({ profil: "sante" }, ["alimentaire"], null)?.cle).toBe("alimentaire");
    expect(profilDeLArticle({}, ["messagerie", "vrac"], null)?.cle).toBe("vrac");
    expect(profilDeLArticle({}, ["messagerie"], null)).toBeNull();
  });
});

describe("alerte « DLC proche » (J-n selon le profil)", () => {
  const articles = [
    { id: "a1", code: "DOLI", nom: "Doliprane 500", unite: "boîte", actif: true, profil: "pharmacie" },
    { id: "a2", code: "YAO", nom: "Yaourt nature", unite: "pièce", actif: true, profil: "alimentaire" },
    { id: "a3", code: "VIS", nom: "Vis", unite: "pièce", actif: true, profil: "vrac" },
    { id: "a4", code: "OLD", nom: "Ancien", unite: "pièce", actif: false, profil: "alimentaire" },
  ];
  const actifs = ["pharmacie", "alimentaire", "vrac"] as const;
  const s = (article_id: string, lot: string, dlc: string | null, quantite = 3): Solde => ({ article_id, site_id: "s1", emplacement_id: null, lot, dlc, quantite });
  it("chaque profil a son délai : 90 jours médicaments, 7 jours alimentaire, 30 jours vrac", () => {
    const r = lotsDlcProches(articles, [s("a1", "L1", "2027-01-15"), s("a2", "L2", "2026-11-04"), s("a2", "L3", "2026-11-06"), s("a3", "L4", "2026-11-20")], "2026-10-28", actifs, null);
    // a1 : 79 jours (≤ 90) ; a2 L2 : 7 jours (≤ 7) ; a2 L3 : 9 jours (> 7) ; a3 : 23 jours (≤ 30)
    expect(r.map((x) => x.cle)).toEqual([cleAlerteDlc("a2", "L2"), cleAlerteDlc("a3", "L4"), cleAlerteDlc("a1", "L1")]);
  });
  it("DLC dépassée : signalée avec un nombre de jours négatif", () => {
    const r = lotsDlcProches(articles, [s("a2", "L2", "2026-10-20")], "2026-10-28", actifs, null);
    expect(r[0]).toMatchObject({ jours: -8, lot: "L2" });
    expect(messageDlcLot(r[0]!)).toBe("DLC dépassée : Yaourt nature (YAO), lot L2, 3 pièce, date limite 20/10/2026 (dépassée depuis 8 jours).");
  });
  it("délai réglable par l'entreprise : J-3 pour l'alimentaire, ou pas d'alerte du tout", () => {
    const c3: ProfilsConfig = { version: 1, actifs: ["alimentaire"], profils: { alimentaire: { alertes: { dlc_jours: 3 } } } };
    expect(lotsDlcProches(articles, [s("a2", "L2", "2026-11-04")], "2026-10-28", ["alimentaire"], c3)).toEqual([]);
    expect(lotsDlcProches(articles, [s("a2", "L2", "2026-10-30")], "2026-10-28", ["alimentaire"], c3)).toHaveLength(1);
    const sans: ProfilsConfig = { version: 1, actifs: ["alimentaire"], profils: { alimentaire: { alertes: { dlc_jours: null } } } };
    expect(lotsDlcProches(articles, [s("a2", "L2", "2026-10-01")], "2026-10-28", ["alimentaire"], sans)).toEqual([]);
  });
  it("articles inactifs, lots épuisés et lots sans DLC ignorés ; un même lot en plusieurs emplacements est cumulé", () => {
    const r = lotsDlcProches(articles, [s("a4", "L", "2026-10-29"), s("a2", "L2", "2026-10-29", 0), s("a2", "L5", null), s("a2", "L6", "2026-10-30", 2), s("a2", "L6", "2026-10-29", 4)], "2026-10-28", actifs, null);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ lot: "L6", quantite: 6, dlc: "2026-10-29", jours: 1 });
  });
  it("décisions : une alerte par lot, close quand le lot est épuisé ou sorti du délai", () => {
    const lots = [{ cle: cleAlerteDlc("a1", "L1") }, { cle: cleAlerteDlc("a2", "L2") }];
    const ouvertes = [
      { id: "x1", type: "stock_dlc_proche", related_id: "a1", cle_dedoublonnage: cleAlerteDlc("a1", "L1") },
      { id: "x2", type: "stock_dlc_proche", related_id: "a3", cle_dedoublonnage: cleAlerteDlc("a3", "L9") },
      { id: "x3", type: "stock_seuil", related_id: "a3", cle_dedoublonnage: "stock:seuil:a3" },
    ];
    const d = decisionsDlc(lots, ouvertes);
    expect(d.aSignaler.map((l) => l.cle)).toEqual([cleAlerteDlc("a2", "L2")]);
    expect(d.aClore).toEqual(["x2"]);
  });
  it("unités individualisées : comptées selon le délai de leur profil, en stock seulement", () => {
    const unites = [
      { profil: "sante", dlc: "2026-10-29", statut: "dans_depot" },
      { profil: "sante", dlc: "2026-11-30", statut: "dans_depot" },
      { profil: "sante", dlc: "2026-10-29", statut: "livre" },
      { profil: "messagerie", dlc: "2026-10-29", statut: "dans_depot" },
      { profil: null, dlc: null, statut: "dans_depot" },
    ];
    expect(unitesDlcProches(unites, "2026-10-28", ["sante", "messagerie"], null)).toEqual({ nombre: 1, delaiMax: 2 });
  });
  it("messages en français, pluriel géré", () => {
    expect(messageDlcUnites(1, 2)).toBe("1 unité en stock a une date limite dans les 2 prochains jours (ou dépassée).");
    expect(messageDlcUnites(3, 2)).toBe("3 unités en stock ont une date limite dans les 2 prochains jours (ou dépassée).");
  });
});
