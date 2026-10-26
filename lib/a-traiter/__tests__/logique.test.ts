import { describe, expect, it } from "vitest";
import {
  LIBELLES_TYPE,
  PLAFOND_PAR_SOURCE,
  TYPES_MANAGER,
  typeVisiblePour,
  TYPES_A_TRAITER,
  calculerUrgence,
  compter,
  construireListe,
  evaluerAuteur,
  filtrerParTypes,
  libelleDuree,
  libelleNombre,
  trier,
  typesDepuisTexte,
  type ElementATraiter,
  type ElementBrut,
  type PersonneConnue,
} from "@/lib/a-traiter/logique";

const MAINTENANT = new Date("2026-10-23T10:00:00Z");
const il_y_a = (heures: number) => new Date(MAINTENANT.getTime() - heures * 3600000).toISOString();
const dans = (heures: number) => new Date(MAINTENANT.getTime() + heures * 3600000).toISOString();

describe("calculerUrgence", () => {
  it("normale par défaut, haute si la source la déclare", () => {
    expect(calculerUrgence("conge", { depuis: il_y_a(1) }, MAINTENANT)).toBe("normale");
    expect(calculerUrgence("entretien", { depuis: il_y_a(1), critique: true }, MAINTENANT)).toBe("haute");
  });

  it("haute quand la demande attend depuis le seuil du type", () => {
    expect(calculerUrgence("ecart_carburant", { depuis: il_y_a(47) }, MAINTENANT)).toBe("normale");
    expect(calculerUrgence("ecart_carburant", { depuis: il_y_a(48) }, MAINTENANT)).toBe("haute");
  });

  it("haute quand l'échéance est proche ou dépassée", () => {
    expect(calculerUrgence("tournee_sans_chauffeur", { echeance: dans(5) }, MAINTENANT)).toBe("normale");
    expect(calculerUrgence("tournee_sans_chauffeur", { echeance: dans(2) }, MAINTENANT)).toBe("haute");
    expect(calculerUrgence("tournee_sans_chauffeur", { echeance: il_y_a(1) }, MAINTENANT)).toBe("haute");
    expect(calculerUrgence("ticpe", { echeance: "2026-11-30" }, MAINTENANT)).toBe("normale");
    expect(calculerUrgence("ticpe", { echeance: "2026-10-28" }, MAINTENANT)).toBe("haute");
  });

  it("tournée fusionnée à répartir : urgente à l'approche du départ", () => {
    expect(calculerUrgence("repartition_a_attribuer", { echeance: dans(5) }, MAINTENANT)).toBe("normale");
    expect(calculerUrgence("repartition_a_attribuer", { echeance: dans(2) }, MAINTENANT)).toBe("haute");
  });

  it("ignore une date illisible", () => {
    expect(calculerUrgence("conge", { depuis: "pas une date", echeance: "" }, MAINTENANT)).toBe("normale");
  });
});

describe("tri, comptage, filtres", () => {
  const el = (cle: string, urgence: "haute" | "normale", depuis: string | null, type: ElementATraiter["type"] = "conge", echeance: string | null = null) =>
    ({ cle, urgence, depuis, echeance, type }) as Pick<ElementATraiter, "cle" | "urgence" | "depuis" | "echeance" | "type">;

  it("urgence d'abord, puis le plus ancien", () => {
    const tries = trier([el("a", "normale", il_y_a(100)), el("b", "haute", il_y_a(1)), el("c", "haute", il_y_a(30)), el("d", "normale", il_y_a(5))]);
    expect(tries.map((e) => e.cle)).toEqual(["c", "b", "a", "d"]);
  });

  it("sans date de demande, l'échéance sert d'ancienneté ; sans rien, en dernier ; ordre stable à égalité", () => {
    const tries = trier([el("z", "normale", null), el("m", "normale", null, "conge", il_y_a(2)), el("b", "normale", il_y_a(10)), el("a", "normale", il_y_a(10))]);
    expect(tries.map((e) => e.cle)).toEqual(["a", "b", "m", "z"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const entree = [el("a", "normale", il_y_a(1)), el("b", "haute", il_y_a(1))];
    trier(entree);
    expect(entree.map((e) => e.cle)).toEqual(["a", "b"]);
  });

  it("compte le total, les urgents et chaque type", () => {
    const c = compter([el("1", "haute", null, "conge"), el("2", "normale", null, "conge"), el("3", "haute", null, "arret")]);
    expect(c.total).toBe(3);
    expect(c.hautes).toBe(2);
    expect(c.parType.conge).toBe(2);
    expect(c.parType.arret).toBe(1);
    expect(c.parType.amende).toBe(0);
    expect(Object.keys(c.parType).sort()).toEqual([...TYPES_A_TRAITER].sort());
  });

  it("filtre par types ; aucun type retenu = tout", () => {
    const liste = [el("1", "haute", null, "conge"), el("2", "normale", null, "arret"), el("3", "normale", null, "amende")];
    expect(filtrerParTypes(liste, new Set(["conge", "amende"])).map((e) => e.cle)).toEqual(["1", "3"]);
    expect(filtrerParTypes(liste, new Set()).length).toBe(3);
    expect(filtrerParTypes(liste, null).length).toBe(3);
  });

  it("lit les types d'une adresse et ignore les inconnus", () => {
    expect(typesDepuisTexte("arret, conge,n'importe quoi")).toEqual(["conge", "arret"]);
    expect(typesDepuisTexte(undefined)).toEqual([]);
  });
});

describe("libellés", () => {
  it("durée passée et future", () => {
    expect(libelleDuree(il_y_a(0.01), MAINTENANT)).toBe("à l'instant");
    expect(libelleDuree(il_y_a(0.5), MAINTENANT)).toBe("il y a 30 min");
    expect(libelleDuree(il_y_a(5), MAINTENANT)).toBe("il y a 5 h");
    expect(libelleDuree(il_y_a(72), MAINTENANT)).toBe("il y a 3 j");
    expect(libelleDuree(dans(2), MAINTENANT)).toBe("dans 2 h");
    expect(libelleDuree(null, MAINTENANT)).toBeNull();
  });

  it("nombre plafonné", () => {
    expect(libelleNombre(200, true)).toBe("200+");
    expect(libelleNombre(12, false)).toBe("12");
    expect(PLAFOND_PAR_SOURCE).toBe(200);
  });
});

describe("règle d'auteur (personne ne décide sa propre demande)", () => {
  const exploitation = { id: "ex1", role: "exploitation" };
  const direction = { id: "dir1", role: "direction" };

  it("sans auteur : libre", () => {
    expect(evaluerAuteur({ moi: exploitation, auteur: null, directionCount: 2 }).etat).toBe("libre");
  });

  it("rang supérieur à celui de l'auteur : autorisé", () => {
    expect(evaluerAuteur({ moi: exploitation, auteur: { id: "c1", role: "chauffeur" }, directionCount: 2 }).etat).toBe("autorise");
    expect(evaluerAuteur({ moi: exploitation, auteur: { id: "m1", role: "manager" }, directionCount: 2 }).etat).toBe("autorise");
    expect(evaluerAuteur({ moi: direction, auteur: { id: "ex1", role: "exploitation" }, directionCount: 2 }).etat).toBe("autorise");
  });

  it("sa propre demande : verrouillée, avec l'explication", () => {
    const r = evaluerAuteur({ moi: exploitation, auteur: { id: "ex1", role: "exploitation" }, directionCount: 2 });
    expect(r.etat).toBe("verrouille");
    expect(r.raison).toMatch(/propre demande/);
    expect(r.raison).toMatch(/direction/);
  });

  it("la direction n'est pas autorisée à s'auto-valider quand elle n'est pas seule", () => {
    expect(evaluerAuteur({ moi: direction, auteur: { id: "dir1", role: "direction" }, directionCount: 2 }).etat).toBe("verrouille");
  });

  it("la direction seule peut s'auto-valider (décision tracée)", () => {
    expect(evaluerAuteur({ moi: direction, auteur: { id: "dir1", role: "direction" }, directionCount: 1 }).etat).toBe("auto");
  });

  it("l'exploitation ne s'auto-valide jamais, même seule de son rôle", () => {
    expect(evaluerAuteur({ moi: exploitation, auteur: { id: "ex1", role: "exploitation" }, directionCount: 1 }).etat).toBe("verrouille");
  });

  it("un pair ou un supérieur : masqué (personne ne voit ce qu'il ne peut pas traiter)", () => {
    expect(evaluerAuteur({ moi: exploitation, auteur: { id: "ex2", role: "exploitation" }, directionCount: 2 }).etat).toBe("masque");
    expect(evaluerAuteur({ moi: exploitation, auteur: { id: "d9", role: "direction" }, directionCount: 2 }).etat).toBe("masque");
  });

  it("la direction décide pour une autre personne de la direction", () => {
    expect(evaluerAuteur({ moi: direction, auteur: { id: "dir2", role: "direction" }, directionCount: 2 }).etat).toBe("autorise");
  });
});

describe("construireListe", () => {
  const personnes = new Map<string, PersonneConnue>([
    ["ex1", { role: "exploitation", nom: "Moi Exploitation" }],
    ["ex2", { role: "exploitation", nom: "Pair Exploitation" }],
    ["c1", { role: "chauffeur", nom: "Chauffeur Un" }],
    ["m1", { role: "manager", nom: "Manager Un" }],
  ]);
  const base = { href: "/x", ecran: "equipe.conges" };
  const brute = (p: Partial<ElementBrut> & Pick<ElementBrut, "id">): ElementBrut => ({ type: "conge", libelle: "Congé · {nom}", ...base, ...p });
  const moi = { id: "ex1", role: "exploitation" };
  const liste = (brutes: ElementBrut[], directionCount = 2) => construireListe({ brutes, moi, personnes, directionCount, maintenant: MAINTENANT });

  it("remplace {nom} par le nom de la personne citée", () => {
    const r = liste([brute({ id: "1", auteurId: "c1", personneId: "c1" })]);
    expect(r.elements[0]!.libelle).toBe("Congé · Chauffeur Un");
  });

  it("sans nom connu : « un salarié »", () => {
    const r = liste([brute({ id: "1", auteurId: "inconnu", personneId: "inconnu" })]);
    expect(r.elements[0]!.libelle).toBe("Congé · un salarié");
  });

  it("ses propres demandes sont verrouillées et ne comptent pas", () => {
    const r = liste([brute({ id: "1", auteurId: "c1", personneId: "c1" }), brute({ id: "2", auteurId: "ex1", personneId: "ex1", groupable: true })]);
    expect(r.elements.map((e) => e.id)).toEqual(["1"]);
    expect(r.verrouilles.map((e) => e.id)).toEqual(["2"]);
    expect(r.verrouilles[0]!.verrou).toMatch(/propre demande/);
    expect(r.verrouilles[0]!.groupable).toBe(false);
  });

  it("la demande d'un pair n'est montrée à personne qui ne peut la traiter", () => {
    const r = liste([brute({ id: "3", auteurId: "ex2", personneId: "ex2" })]);
    expect(r.elements).toEqual([]);
    expect(r.verrouilles).toEqual([]);
  });

  it("choix libre (amende) : reste visible, mais jamais groupable si le responsable proposé est inadmissible", () => {
    const r = liste([brute({ id: "4", type: "amende", auteurId: "ex1", personneId: "ex1", choixLibre: true, groupable: true }), brute({ id: "5", type: "amende", auteurId: "ex2", choixLibre: true, groupable: true }), brute({ id: "6", type: "amende", auteurId: "c1", choixLibre: true, groupable: true })]);
    expect(r.elements.map((e) => [e.id, e.groupable])).toEqual(expect.arrayContaining([["4", false], ["5", false], ["6", true]]));
    expect(r.verrouilles).toEqual([]);
  });

  it("direction seule : sa propre demande reste traitable, marquée auto-validation", () => {
    const direction = { id: "dir1", role: "direction" };
    const r = construireListe({
      brutes: [brute({ id: "7", auteurId: "dir1", personneId: "dir1", groupable: true })],
      moi: direction,
      personnes: new Map([["dir1", { role: "direction", nom: "Patron" }]]),
      directionCount: 1,
      maintenant: MAINTENANT,
    });
    expect(r.elements[0]!.autoValidation).toBe(true);
    expect(r.elements[0]!.groupable).toBe(true);
    expect(r.verrouilles).toEqual([]);
  });

  it("direction non seule : sa propre demande est verrouillée", () => {
    const direction = { id: "dir1", role: "direction" };
    const r = construireListe({
      brutes: [brute({ id: "7", auteurId: "dir1", personneId: "dir1" })],
      moi: direction,
      personnes: new Map([["dir1", { role: "direction", nom: "Patron" }]]),
      directionCount: 2,
      maintenant: MAINTENANT,
    });
    expect(r.elements).toEqual([]);
    expect(r.verrouilles.length).toBe(1);
  });

  it("un auteur dont le rôle est illisible est traité comme un chauffeur (comme la route serveur)", () => {
    expect(liste([brute({ id: "8", auteurId: "fantome" })]).elements.length).toBe(1);
  });

  it("trie le résultat : urgents d'abord, puis le plus ancien", () => {
    const r = liste([
      brute({ id: "a", depuis: il_y_a(10) }),
      brute({ id: "b", depuis: il_y_a(200) }),
      brute({ id: "c", type: "entretien", critique: true, depuis: il_y_a(1), ecran: "flotte.entretien" }),
    ]);
    // b (200 h >= 120 h) et c (critique) sont urgents, b est le plus ancien ; a (10 h) est normal.
    expect(r.elements.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(r.elements.map((e) => e.urgence)).toEqual(["haute", "haute", "normale"]);
  });

  it("les éléments sans auteur (tournées, TICPE) sont toujours à traiter", () => {
    const r = liste([brute({ id: "t1", type: "tournee_sans_chauffeur", echeance: dans(1) }), brute({ id: "t2", type: "ticpe" })]);
    expect(r.elements.length).toBe(2);
  });
});

describe("types par rôle et vocabulaire", () => {
  it("manager : seulement les types de ses services ; exploitation et direction : tous", () => {
    expect(typeVisiblePour("conge", "manager")).toBe(true);
    expect(typeVisiblePour("amende", "manager")).toBe(false);
    expect(typeVisiblePour("bulletin_paie", "manager")).toBe(false);
    expect(TYPES_A_TRAITER.every((t) => typeVisiblePour(t, "direction"))).toBe(true);
    // La paie reste à la direction : jamais l'exploitation.
    expect(TYPES_A_TRAITER.filter((t) => !typeVisiblePour(t, "exploitation"))).toEqual(["bulletin_paie"]);
    expect(TYPES_MANAGER.every((t) => (TYPES_A_TRAITER as readonly string[]).includes(t))).toBe(true);
  });
  it("libellés non inversés : non démarrée / en retard", () => {
    expect(LIBELLES_TYPE.tournee_non_demarree.singulier).toBe("Tournée non démarrée");
    expect(LIBELLES_TYPE.tournee_en_retard.singulier).toBe("Tournée en retard");
  });
});
