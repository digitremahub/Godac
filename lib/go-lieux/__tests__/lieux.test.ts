import { describe, expect, it } from "vitest";
import {
  MAX_FAVORIS_NOMMES,
  MAX_RECENTS,
  ajouterFavori,
  ajouterRecent,
  cleLieu,
  effacerRecents,
  lieuDepuisLigne,
  lieuSaisieSchema,
  memeLieu,
  nettoyerLibelle,
  ordonnerFavoris,
  recentsPerimes,
  renommer,
  supprimer,
  type Lieu,
  type LieuSaisie,
} from "@/lib/go-lieux/lieux";
import { GO_LIEUX_RECENTS_JOURS, limiteLieuxRecents } from "@/lib/retention/lieux-go";

const lieu = (n: number): LieuSaisie => ({ libelle: `Lieu ${n}`, adresse: `${n} rue des Tests, Lyon`, lat: 45 + n / 100, lng: 4 + n / 100 });
const t0 = new Date("2026-10-29T10:00:00Z");

describe("récents : 10 au plus, en tête, sans doublon", () => {
  it("plafonne à 10 et fait disparaître le plus ancien", () => {
    let r: Lieu[] = [];
    for (let i = 1; i <= 12; i++) r = ajouterRecent(r, lieu(i), `id${i}`, new Date(t0.getTime() + i * 1000));
    expect(MAX_RECENTS).toBe(10);
    expect(r).toHaveLength(10);
    expect(r[0]!.adresse).toContain("12 rue");
    expect(r.some((x) => x.adresse.startsWith("1 rue"))).toBe(false);
    expect(r.some((x) => x.adresse.startsWith("2 rue"))).toBe(false);
  });
  it("une destination déjà vue remonte en tête sans doublon (même adresse écrite autrement)", () => {
    let r = ajouterRecent([], lieu(1), "a", t0);
    r = ajouterRecent(r, lieu(2), "b", new Date(t0.getTime() + 1000));
    r = ajouterRecent(r, { ...lieu(1), adresse: "1 RUE des tests,  LYON" }, "c", new Date(t0.getTime() + 2000));
    expect(r).toHaveLength(2);
    expect(r[0]!.adresse).toContain("1 RUE");
  });
  it("deux lieux à moins de 25 m sont le même lieu", () => {
    expect(memeLieu({ adresse: "A", lat: 45, lng: 4 }, { adresse: "B", lat: 45.0001, lng: 4 })).toBe(true);
    expect(memeLieu({ adresse: "A", lat: 45, lng: 4 }, { adresse: "B", lat: 45.01, lng: 4 })).toBe(false);
  });
  it("tout effacer l'historique garde les favoris", () => {
    const f = ajouterFavori([], lieu(1), "f1");
    const r = ajouterRecent([], lieu(2), "r1", t0);
    const tout = [...(f.ok ? f.favoris : []), ...r];
    expect(effacerRecents(tout).map((l) => l.genre)).toEqual(["favori"]);
  });
  it("90 jours : un récent plus vieux est périmé, la limite de purge est 90 jours avant", () => {
    const r = ajouterRecent([], lieu(1), "a", new Date("2026-07-01T00:00:00Z"));
    expect(recentsPerimes(r, t0)).toHaveLength(1);
    expect(recentsPerimes(r, new Date("2026-08-01T00:00:00Z"))).toHaveLength(0);
    expect(GO_LIEUX_RECENTS_JOURS).toBe(90);
    expect(limiteLieuxRecents(new Date("2026-10-29T00:00:00Z"))).toBe("2026-07-31T00:00:00.000Z");
  });
});

describe("favoris : Domicile, Travail, 20 nommés", () => {
  it("Domicile et Travail remplacent l'existant, un seul de chaque", () => {
    const a = ajouterFavori([], lieu(1), "d1", "domicile");
    expect(a.ok && a.lieu.libelle).toBe("Domicile");
    const b = ajouterFavori(a.ok ? a.favoris : [], lieu(2), "d2", "domicile");
    expect(b.ok && b.favoris.filter((f) => f.type_lieu === "domicile")).toHaveLength(1);
    expect(b.ok && b.favoris[0]!.adresse).toContain("2 rue");
  });
  it("plafond de 20 favoris nommés (Domicile et Travail en plus)", () => {
    let f: Lieu[] = [];
    for (let i = 1; i <= MAX_FAVORIS_NOMMES; i++) {
      const r = ajouterFavori(f, lieu(i), `f${i}`);
      expect(r.ok).toBe(true);
      if (r.ok) f = r.favoris;
    }
    expect(ajouterFavori(f, lieu(99), "x")).toEqual({ ok: false, motif: "plafond" });
    const dom = ajouterFavori(f, lieu(98), "dom", "domicile");
    expect(dom.ok).toBe(true);
  });
  it("refuse un doublon et un nom vide", () => {
    const a = ajouterFavori([], lieu(1), "f1");
    expect(ajouterFavori(a.ok ? a.favoris : [], lieu(1), "f2")).toEqual({ ok: false, motif: "doublon" });
    expect(ajouterFavori([], { ...lieu(1), libelle: "   " }, "f3")).toEqual({ ok: false, motif: "invalide" });
  });
  it("renomme un favori nommé, pas Domicile ni Travail", () => {
    const n = ajouterFavori([], lieu(1), "f1");
    const d = ajouterFavori(n.ok ? n.favoris : [], lieu(2), "d1", "domicile");
    const favoris = d.ok ? d.favoris : [];
    expect(renommer(favoris, "f1", "  Chez   Paul ")!.find((l) => l.id === "f1")!.libelle).toBe("Chez Paul");
    expect(renommer(favoris, "d1", "Autre")).toBeNull();
    expect(renommer(favoris, "f1", "  ")).toBeNull();
    expect(supprimer(favoris, "f1")).toHaveLength(1);
  });
  it("Domicile, Travail puis ordre alphabétique", () => {
    const l = (id: string, libelle: string, type: Lieu["type_lieu"]): Lieu => ({ id, genre: "favori", type_lieu: type, libelle, adresse: id, lat: 0, lng: 0, dernier_usage: "2026-01-01T00:00:00Z" });
    expect(ordonnerFavoris([l("1", "Zoo", null), l("2", "Travail", "travail"), l("3", "Banque", null), l("4", "Domicile", "domicile")]).map((x) => x.libelle)).toEqual(["Domicile", "Travail", "Banque", "Zoo"]);
  });
});

describe("validation", () => {
  it("nettoie le nom (60 caractères, contrôles retirés)", () => {
    expect(nettoyerLibelle("a\u0000b\n  c")).toBe("a b c");
    expect(nettoyerLibelle("x".repeat(100))).toHaveLength(60);
    expect(cleLieu("12, Rue de l'Été")).toBe(cleLieu("12 rue de l ete"));
  });
  it("refuse coordonnées hors limites, adresse trop courte, nom vide", () => {
    expect(lieuSaisieSchema.safeParse({ ...lieu(1), lat: 91 }).success).toBe(false);
    expect(lieuSaisieSchema.safeParse({ ...lieu(1), lng: -181 }).success).toBe(false);
    expect(lieuSaisieSchema.safeParse({ ...lieu(1), adresse: "ab" }).success).toBe(false);
    expect(lieuSaisieSchema.safeParse({ ...lieu(1), libelle: " " }).success).toBe(false);
    expect(lieuSaisieSchema.safeParse(lieu(1)).success).toBe(true);
  });
  it("ignore une ligne corrompue", () => {
    expect(lieuDepuisLigne({ id: "1", genre: "x", libelle: "a", adresse: "b", lat: 1, lng: 1 })).toBeNull();
    expect(lieuDepuisLigne({ id: "1", genre: "favori", libelle: "a", adresse: "b", lat: 200, lng: 1 })).toBeNull();
    expect(lieuDepuisLigne({ id: "1", genre: "favori", type_lieu: "domicile", libelle: "a", adresse: "b", lat: "45.5", lng: "4.1", dernier_usage: "2026-01-01T00:00:00Z" })?.lat).toBe(45.5);
  });
});
