import { describe, expect, it } from "vitest";
import { appliquerChangements, reordonner, type ArretOrdonne } from "@/lib/colis/reordonner";

const A = (id: string, position: number, list_id: string | null = "v1"): ArretOrdonne => ({ id, position, list_id });
const tournee = [A("a", 0), A("b", 1), A("c", 2), A("d", 3, "v2"), A("e", 4, "v2")];
const ordre = (arrets: ArretOrdonne[]) => arrets.map((a) => `${a.id}:${a.list_id}`).join(" ");

describe("glisser-déposer des arrêts", () => {
  it("dans une même liste : devant un autre arrêt, positions contiguës", () => {
    const ch = reordonner(tournee, "c", { list_id: "v1", avant_id: "a" });
    expect(ch).toEqual([
      { id: "c", position: 0, list_id: "v1" },
      { id: "a", position: 1, list_id: "v1" },
      { id: "b", position: 2, list_id: "v1" },
    ]);
    expect(ordre(appliquerChangements(tournee, ch))).toBe("c:v1 a:v1 b:v1 d:v2 e:v2");
  });

  it("en fin de liste", () => {
    const ch = reordonner(tournee, "a", { list_id: "v1", avant_id: null });
    expect(ordre(appliquerChangements(tournee, ch))).toBe("b:v1 c:v1 a:v1 d:v2 e:v2");
  });

  it("vers une autre liste : devant un arrêt ou en fin de liste", () => {
    expect(ordre(appliquerChangements(tournee, reordonner(tournee, "b", { list_id: "v2", avant_id: "e" })))).toBe("a:v1 c:v1 d:v2 b:v2 e:v2");
    expect(ordre(appliquerChangements(tournee, reordonner(tournee, "a", { list_id: "v2", avant_id: null })))).toBe("b:v1 c:v1 d:v2 e:v2 a:v2");
    // La liste de l'arrêt visé l'emporte sur celle demandée.
    expect(ordre(appliquerChangements(tournee, reordonner(tournee, "a", { list_id: "v1", avant_id: "e" })))).toBe("b:v1 c:v1 d:v2 a:v2 e:v2");
  });

  it("aucun changement ou cible inconnue : rien à écrire", () => {
    expect(reordonner(tournee, "b", { list_id: "v1", avant_id: "c" })).toEqual([]);
    expect(reordonner(tournee, "a", { list_id: "v1", avant_id: "a" })).toEqual([]);
    expect(reordonner(tournee, "z", { list_id: "v1", avant_id: null })).toEqual([]);
    expect(reordonner(tournee, "a", { list_id: "v1", avant_id: "z" })).toEqual([]);
  });

  it("positions non contiguës (arrêts supprimés) : renumérotées", () => {
    const trous = [A("a", 0), A("b", 5), A("c", 9)];
    expect(reordonner(trous, "c", { list_id: "v1", avant_id: "b" })).toEqual([
      { id: "c", position: 1, list_id: "v1" },
      { id: "b", position: 2, list_id: "v1" },
    ]);
  });
});

describe("cible d'un dépôt d'après l'arrêt survolé", () => {
  const affiche = tournee.map(({ id, list_id }) => ({ id, list_id: list_id ?? null }));
  it("en montant : devant l'arrêt survolé ; en descendant : après", async () => {
    const { cibleDepuisSurvol } = await import("@/lib/colis/reordonner");
    expect(cibleDepuisSurvol(affiche, "c", "a")).toEqual({ list_id: "v1", avant_id: "a" });
    expect(cibleDepuisSurvol(affiche, "a", "b")).toEqual({ list_id: "v1", avant_id: "c" });
    expect(cibleDepuisSurvol(affiche, "a", "c")).toEqual({ list_id: "v1", avant_id: null });
    expect(cibleDepuisSurvol(affiche, "a", "d")).toEqual({ list_id: "v2", avant_id: "e" });
    expect(cibleDepuisSurvol(affiche, "e", "b")).toEqual({ list_id: "v1", avant_id: "b" });
    expect(cibleDepuisSurvol(affiche, "a", "a")).toBeNull();
    // Le résultat appliqué donne bien l'ordre attendu.
    expect(ordre(appliquerChangements(tournee, reordonner(tournee, "a", cibleDepuisSurvol(affiche, "a", "c")!)))).toBe("b:v1 c:v1 a:v1 d:v2 e:v2");
  });
});
