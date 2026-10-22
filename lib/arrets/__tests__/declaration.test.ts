import { describe, expect, it } from "vitest";
import {
  affectationsALiberer,
  affectationsTouchees,
  arretsProlongeables,
  envoiTardif,
  estEnArret,
  heuresPrevuesDuMois,
  joursArret,
  joursArretDuMois,
  messageAlerteEncadrement,
  messageDecisionSalarie,
  pointageAttendu,
  verifierDeclaration,
  type ArretExistant,
} from "../declaration";
import { arretsDuBulletin } from "@/lib/paie/arrets";

describe("jours d'arrêt dans un mois", () => {
  it("coupe l'arrêt aux bornes du mois", () => {
    const j = joursArretDuMois([{ du: "2026-09-28", au: "2026-10-03" }], "2026-10");
    expect(j).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("union sans doublon de deux arrêts qui se touchent (prolongation)", () => {
    const j = joursArret(
      [
        { du: "2026-10-05", au: "2026-10-09", statut: "valide" },
        { du: "2026-10-09", au: "2026-10-12", statut: "recu" },
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(j).toHaveLength(8);
  });

  it("un arrêt refusé ne compte pas", () => {
    expect(joursArretDuMois([{ du: "2026-10-05", au: "2026-10-09", statut: "refuse" }], "2026-10")).toEqual([]);
    expect(estEnArret([{ du: "2026-10-05", au: "2026-10-09", statut: "refuse" }], "2026-10-06")).toBe(false);
    expect(estEnArret([{ du: "2026-10-05", au: "2026-10-09" }], "2026-10-06")).toBe(true);
  });
});

describe("heures prévues et pointage neutralisés", () => {
  it("retire les jours ouvrés d'arrêt des heures du contrat", () => {
    // Octobre 2026 : 22 jours ouvrés ; arrêt du lundi 5 au dimanche 11 = 5 jours ouvrés.
    const r = heuresPrevuesDuMois(151.67, "2026-10", [{ du: "2026-10-05", au: "2026-10-11" }]);
    expect(r.joursOuvresMois).toBe(22);
    expect(r.joursOuvresArret).toBe(5);
    expect(r.joursArret).toBe(7);
    expect(r.heures).toBeCloseTo((151.67 * 17) / 22, 2);
  });

  it("mois entier d'arrêt : aucune heure prévue ; sans arrêt : le contrat", () => {
    expect(heuresPrevuesDuMois(151.67, "2026-10", [{ du: "2026-09-20", au: "2026-11-05" }]).heures).toBe(0);
    expect(heuresPrevuesDuMois(151.67, "2026-10", []).heures).toBe(151.67);
  });

  it("pas de pointage attendu un jour d'arrêt, même planifié", () => {
    const planifies = new Set(["2026-10-06", "2026-10-20"]);
    const arrets = [{ du: "2026-10-05", au: "2026-10-09" }];
    expect(pointageAttendu("2026-10-06", arrets, planifies)).toBe(false);
    expect(pointageAttendu("2026-10-20", arrets, planifies)).toBe(true);
    expect(pointageAttendu("2026-10-21", arrets, planifies)).toBe(false);
  });
});

describe("affectations du planning touchées", () => {
  const entries = [
    { id: "a", start_at: "2026-10-05T04:30:00Z", status: "planned" }, // lundi 5, 6 h 30 Paris
    { id: "b", start_at: "2026-10-04T22:30:00Z", status: "planned" }, // lundi 5, 0 h 30 Paris
    { id: "c", start_at: "2026-10-09T05:00:00Z", status: "in_progress" },
    { id: "d", start_at: "2026-10-07T05:00:00Z", status: "done" },
    { id: "e", start_at: "2026-10-10T05:00:00Z", status: "planned" }, // hors arrêt
    { id: "f", start_at: "2026-10-04T21:30:00Z", status: "planned" }, // dimanche 4, 23 h 30 Paris
  ];
  const arret = { du: "2026-10-05", au: "2026-10-09" };

  it("jour de Paris du départ prévu, tournées encore à faire, triées", () => {
    expect(affectationsTouchees(entries, arret).map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("à libérer : seulement prévues et à venir", () => {
    expect(affectationsALiberer(entries, arret, new Date("2026-10-05T00:00:00Z")).map((e) => e.id)).toEqual(["a"]);
    expect(affectationsALiberer(entries, arret, new Date("2026-10-01T00:00:00Z")).map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("déclaration et prolongation", () => {
  const existants: ArretExistant[] = [
    { id: "x1", type: "maladie", du: "2026-10-01", au: "2026-10-07", statut: "valide" },
    { id: "x2", type: "maladie", du: "2026-10-08", au: "2026-10-14", extensionOf: "2026-10-01", statut: "recu" },
    { id: "r", type: "maladie", du: "2026-10-20", au: "2026-10-22", statut: "refuse" },
  ];

  it("arrêt initial : dates cohérentes, pas de chevauchement", () => {
    expect(verifierDeclaration({ type: "maladie", du: "2026-10-20", au: "2026-10-25" }, existants, "2026-10-20")).toEqual({ ok: true, extensionOf: null });
    expect(verifierDeclaration({ type: "maladie", du: "2026-10-25", au: "2026-10-20" }, existants, "2026-10-20").ok).toBe(false);
    const chevauche = verifierDeclaration({ type: "maladie", du: "2026-10-06", au: "2026-10-09" }, existants, "2026-10-20");
    expect(chevauche.ok).toBe(false);
  });

  it("prolongation : reprend le début de l'arrêt initial de la chaîne", () => {
    expect(verifierDeclaration({ type: "maladie", du: "2026-10-15", au: "2026-10-18", prolongeId: "x2" }, existants, "2026-10-15")).toEqual({ ok: true, extensionOf: "2026-10-01" });
    expect(verifierDeclaration({ type: "maladie", du: "2026-10-08", au: "2026-10-10", prolongeId: "x1" }, [existants[0]!], "2026-10-08")).toEqual({ ok: true, extensionOf: "2026-10-01" });
  });

  it("prolongation : même type, dans la continuité (week-end toléré)", () => {
    expect(verifierDeclaration({ type: "at_mp", du: "2026-10-15", au: "2026-10-18", prolongeId: "x2" }, existants, "2026-10-15").ok).toBe(false);
    expect(verifierDeclaration({ type: "maladie", du: "2026-10-18", au: "2026-10-20", prolongeId: "x2" }, existants, "2026-10-18").ok).toBe(true);
    expect(verifierDeclaration({ type: "maladie", du: "2026-10-19", au: "2026-10-20", prolongeId: "x2" }, existants, "2026-10-19").ok).toBe(false);
    expect(verifierDeclaration({ type: "maladie", du: "2026-10-12", au: "2026-10-20", prolongeId: "x2" }, existants, "2026-10-12").ok).toBe(false);
    expect(verifierDeclaration({ type: "maladie", du: "2026-10-23", au: "2026-10-25", prolongeId: "r" }, existants, "2026-10-23").ok).toBe(false);
  });

  it("arrêts prolongeables : non refusés et récents, du plus récent", () => {
    expect(arretsProlongeables(existants, "2026-10-20").map((a) => a.id)).toEqual(["x2", "x1"]);
    expect(arretsProlongeables(existants, "2026-12-31")).toEqual([]);
  });
});

describe("messages", () => {
  it("alerte encadrement : jamais le type d'arrêt, tournées à remplacer, DAT pour un AT", () => {
    const m = messageAlerteEncadrement({ nom: "Salarié Test", du: "2026-10-05", au: "2026-10-09", tournees: 3, prolongation: false, accidentTravail: true });
    expect(m).toContain("Salarié Test en arrêt du 05/10/2026 au 09/10/2026 : 3 tournées à remplacer.");
    expect(m).toContain("DAT");
    expect(m.toLowerCase()).not.toContain("maladie");
    expect(messageAlerteEncadrement({ nom: "A", du: "2026-10-05", au: "2026-10-05", tournees: 0, prolongation: true, accidentTravail: false })).toContain("prolongation d'arrêt");
  });

  it("décision au salarié", () => {
    expect(messageDecisionSalarie({ du: "2026-10-05", au: "2026-10-09", statut: "valide" })).toContain("enregistré");
    expect(messageDecisionSalarie({ du: "2026-10-05", au: "2026-10-09", statut: "refuse", motif: "avis illisible" })).toContain("avis illisible");
  });

  it("envoi au-delà de 48 h", () => {
    expect(envoiTardif("2026-10-05", new Date("2026-10-06T10:00:00Z"))).toBe(false);
    expect(envoiTardif("2026-10-05", new Date("2026-10-09T10:00:00Z"))).toBe(true);
  });
});

describe("arrêts du bulletin déjà généré", () => {
  const bulletin = [
    { id: "a", type: "maladie" as const, du: "2026-10-01", au: "2026-10-03", ijssBrutesJour: 20 },
    { type: "sans_solde" as const, du: "2026-10-20", au: "2026-10-20" },
    { id: "r", type: "maladie" as const, du: "2026-10-10", au: "2026-10-12" },
  ];

  it("ligne enregistrée prioritaire, nouvelles déclarations ajoutées, refusées retirées", () => {
    const enBase = [
      { id: "a", type: "maladie" as const, du: "2026-10-01", au: "2026-10-04", ijssBrutesJour: 20 },
      { id: "n", type: "at_mp" as const, du: "2026-10-15", au: "2026-10-16" },
    ];
    const r = arretsDuBulletin(bulletin, enBase, ["r"]);
    expect(r.map((a) => [a.id ?? "-", a.au])).toEqual([
      ["a", "2026-10-04"],
      ["n", "2026-10-16"],
      ["-", "2026-10-20"],
    ]);
  });

  it("sans bulletin : les arrêts enregistrés", () => {
    expect(arretsDuBulletin(null, [{ id: "n", type: "maladie", du: "2026-10-15", au: "2026-10-16" }])).toHaveLength(1);
  });
});
