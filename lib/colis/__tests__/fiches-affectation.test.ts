import { describe, expect, it } from "vitest";
import {
  choixRequis,
  entreesDeLaFiche,
  entreesDuJour,
  entreesOrphelines,
  ficheARelier,
  heureParis,
  nomFiche,
  questionRegroupement,
  type EntreeDuJour,
  type FicheDuJour,
} from "@/lib/colis/fiches-affectation";

const JOUR = "2026-10-21";
// 21/10/2026 : heure d'été, Paris = UTC+2.
const entree = (id: string, heureUtc: string, extra: Partial<EntreeDuJour> = {}): EntreeDuJour => ({
  id,
  tour_number: id.toUpperCase(),
  start_at: `${JOUR}T${heureUtc}:00Z`,
  status: "planned",
  created_at: "2026-10-20T08:00:00Z",
  delivery_run_id: null,
  ...extra,
});
const fiche = (id: string, extra: Partial<FicheDuJour> = {}): FicheDuJour => ({
  id,
  name: `Fiche ${id}`,
  status: "loading",
  created_at: "2026-10-20T09:00:00Z",
  planning_entry_id: null,
  fiche_planifiee: true,
  ...extra,
});

describe("entreesDuJour", () => {
  it("garde les affectations du jour à Paris, non annulées, avec un numéro, triées par heure", () => {
    const r = entreesDuJour(
      [
        entree("b", "12:00"),
        entree("a", "05:00"),
        entree("x", "06:00", { status: "cancelled" }),
        entree("y", "06:00", { tour_number: null }),
        { ...entree("z", "06:00"), start_at: "2026-10-21T22:30:00Z" }, // 22/10 à Paris
      ],
      JOUR,
    );
    expect(r.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("entreesDeLaFiche", () => {
  it("séparée : son entrée d'origine, même si le lien n'est pas encore posé", () => {
    const f = fiche("f1", { planning_entry_id: "a" });
    expect(entreesDeLaFiche(f, [entree("a", "05:00"), entree("b", "12:00")]).map((e) => e.id)).toEqual(["a"]);
  });
  it("reliée : toutes les entrées qui la portent", () => {
    const f = fiche("f1", { planning_entry_id: "a" });
    const r = entreesDeLaFiche(f, [entree("a", "05:00", { delivery_run_id: "f1" }), entree("b", "12:00", { delivery_run_id: "f1" }), entree("c", "14:00", { delivery_run_id: "f2" })]);
    expect(r.map((e) => e.id)).toEqual(["a", "b"]);
  });
  it("libre sans planning : aucune", () => {
    expect(entreesDeLaFiche(fiche("f1", { fiche_planifiee: false }), [entree("a", "05:00")])).toEqual([]);
  });
});

describe("entreesOrphelines", () => {
  it("exclut les entrées portées ou d'origine d'une fiche, et celles déjà faites", () => {
    const fiches = [fiche("f1", { planning_entry_id: "a" }), fiche("f2")];
    const r = entreesOrphelines(
      [entree("a", "05:00"), entree("b", "06:00", { delivery_run_id: "f2" }), entree("c", "07:00"), entree("d", "08:00", { status: "done" })],
      fiches,
    );
    expect(r.map((e) => e.id)).toEqual(["c"]);
  });
  it("ignore celles inscrites avant la dernière fiche libre clôturée (ancien fonctionnement)", () => {
    const fiches = [fiche("f1", { status: "done", fiche_planifiee: false, created_at: "2026-10-21T07:00:00Z" })];
    const r = entreesOrphelines(
      [entree("a", "05:00", { created_at: "2026-10-21T06:00:00Z" }), entree("b", "12:00", { created_at: "2026-10-21T09:00:00Z" })],
      fiches,
    );
    expect(r.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("choixRequis", () => {
  it("aucune autre affectation ni fiche ouverte : pas de question", () => {
    expect(choixRequis([], []).requis).toBe(false);
  });
  it("autre affectation à faire : question avec numéro et heure de Paris", () => {
    const r = choixRequis([entree("t12", "05:30")], []);
    expect(r.requis).toBe(true);
    expect(r.existantes).toEqual([{ tour_number: "T12", heure: "07:30" }]);
  });
  it("affectation portée par une fiche clôturée, ou terminée : pas de question", () => {
    const fiches = [fiche("f1", { status: "done", planning_entry_id: "a" })];
    expect(choixRequis([entree("a", "05:00"), entree("b", "06:00", { status: "done" })], fiches).requis).toBe(false);
  });
  it("fiche libre ouverte sans affectation : question quand même", () => {
    const r = choixRequis([], [fiche("f1", { fiche_planifiee: false, name: "Ma tournée" })]);
    expect(r.requis).toBe(true);
    expect(r.existantes).toEqual([]);
    expect(r.fiches_ouvertes).toEqual([{ id: "f1", name: "Ma tournée" }]);
  });
});

describe("ficheARelier", () => {
  const fiches = [fiche("matin", { planning_entry_id: "a" }), fiche("midi", { planning_entry_id: "b" })];
  const entrees = [entree("a", "05:00", { delivery_run_id: "matin" }), entree("b", "10:00", { delivery_run_id: "midi" })];
  it("rejoint la fiche de l'affectation la plus proche avant", () => {
    expect(ficheARelier(fiches, entrees, `${JOUR}T11:00:00Z`)?.id).toBe("midi");
    expect(ficheARelier(fiches, entrees, `${JOUR}T07:00:00Z`)?.id).toBe("matin");
  });
  it("sinon la plus proche après", () => {
    expect(ficheARelier(fiches, entrees, `${JOUR}T04:00:00Z`)?.id).toBe("matin");
  });
  it("ignore les fiches clôturées ; sans fiche ouverte : null", () => {
    expect(ficheARelier([fiche("f", { status: "done", planning_entry_id: "a" })], entrees, `${JOUR}T11:00:00Z`)).toBeNull();
  });
  it("fiche libre ouverte sans affectation : on la prend", () => {
    expect(ficheARelier([fiche("libre", { fiche_planifiee: false })], [], `${JOUR}T11:00:00Z`)?.id).toBe("libre");
  });
});

describe("libellés", () => {
  it("nom de fiche", () => {
    expect(nomFiche(["12"])).toBe("Tournée n°12");
    expect(nomFiche(["12", "14", "12"])).toBe("Tournées n°12, 14");
    expect(nomFiche(["1", "2", "3", "4", "5"])).toBe("Tournées du jour");
  });
  it("heure de Paris", () => {
    expect(heureParis("2026-12-01T06:05:00Z")).toBe("07:05");
  });
  it("question posée à l'encadrement", () => {
    expect(questionRegroupement({ existantes: [{ tour_number: "12", heure: "07:30" }], fiches_ouvertes: [] })).toBe(
      "Ce chauffeur a déjà la tournée n°12 à 07:30 ce jour-là. Fiches colis séparées (recommandé) ou reliées en une seule tournée ?",
    );
    expect(questionRegroupement({ existantes: [{ tour_number: "1", heure: "06:00" }, { tour_number: "2", heure: "13:00" }], fiches_ouvertes: [] })).toContain(
      "la tournée n°1 à 06:00 et la tournée n°2 à 13:00",
    );
    expect(questionRegroupement({ existantes: [], fiches_ouvertes: [{ id: "f", name: "Libre" }] })).toContain("fiche Tournée colis ouverte ce jour-là (« Libre »)");
  });
});
