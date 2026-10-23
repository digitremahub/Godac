import { describe, expect, it } from "vitest";
import {
  destinatairesNotification,
  droitsDecision,
  estDansLaChaine,
  libelleADecider,
  libelleEnAttente,
  MESSAGE_PROPRE_DEMANDE,
  niveauSuperieur,
  peutDecider,
  rang,
  type UtilisateurOrganisation,
} from "@/lib/hierarchie/demandes";

const ROLES_CHAINE = ["chauffeur", "manager", "exploitation", "direction"] as const;
const p = (id: string, role: string, serviceIds?: string[]) => ({ id, role, serviceIds });

describe("rang", () => {
  it("chauffeur < manager < exploitation < direction", () => {
    expect(ROLES_CHAINE.map(rang)).toEqual([0, 1, 2, 3]);
  });
  it("l'ancien manager_chauffeur vaut un manager ; un rôle inconnu vaut un chauffeur", () => {
    expect(rang("manager_chauffeur")).toBe(1);
    expect(rang("inconnu")).toBe(0);
    expect(rang(null)).toBe(0);
  });
  it("le comptable n'est pas dans la chaîne", () => {
    expect(estDansLaChaine("comptable")).toBe(false);
    expect(ROLES_CHAINE.every(estDansLaChaine)).toBe(true);
  });
});

describe("niveauSuperieur", () => {
  it("monte d'un niveau", () => {
    expect(niveauSuperieur("chauffeur")).toBe("manager");
    expect(niveauSuperieur("manager")).toBe("exploitation");
    expect(niveauSuperieur("exploitation")).toBe("direction");
    expect(niveauSuperieur("direction")).toBe("direction");
    expect(niveauSuperieur("comptable")).toBe("direction");
    expect(niveauSuperieur("manager_chauffeur")).toBe("exploitation");
  });
});

describe("peutDecider : tous les croisements de rôles (personnes différentes, 2 directions)", () => {
  const attendu: Record<string, Record<string, boolean>> = {
    // décideur → demandeur → autorisé ?
    chauffeur: { chauffeur: false, manager: false, exploitation: false, direction: false },
    manager: { chauffeur: true, manager: false, exploitation: false, direction: false },
    exploitation: { chauffeur: true, manager: true, exploitation: false, direction: false },
    direction: { chauffeur: true, manager: true, exploitation: true, direction: true },
  };
  for (const decideur of ROLES_CHAINE) {
    for (const demandeur of ROLES_CHAINE) {
      it(`${decideur} décide pour ${demandeur} : ${attendu[decideur]![demandeur] ? "oui" : "non"}`, () => {
        const v = peutDecider({ decideur: p("d", decideur), demandeur: p("x", demandeur), directionCount: 2 });
        expect(v.ok).toBe(attendu[decideur]![demandeur]);
        if (!v.ok) expect(v.raison).toMatch(/traitée par/);
        if (v.ok) expect(v.autoValidee).toBeUndefined();
      });
    }
  }

  it("le flag « conduit » d'un manager n'existe pas dans le calcul : le rang reste celui du rôle", () => {
    const v = peutDecider({ decideur: p("m1", "manager"), demandeur: p("m2", "manager"), directionCount: 2 });
    expect(v.ok).toBe(false);
  });
});

describe("peutDecider : sa propre demande", () => {
  for (const role of ["chauffeur", "manager", "exploitation", "comptable"]) {
    it(`${role} ne décide jamais de sa propre demande, même seul de son rôle`, () => {
      for (const directionCount of [0, 1, 2, 5]) {
        const v = peutDecider({ decideur: p("a", role), demandeur: p("a", role), directionCount });
        expect(v.ok).toBe(false);
      }
    });
  }

  it("message imposé pour un manager", () => {
    const v = peutDecider({ decideur: p("a", "manager"), demandeur: p("a", "manager"), directionCount: 1 });
    expect(v).toEqual({ ok: false, raison: `${MESSAGE_PROPRE_DEMANDE}.` });
    expect(MESSAGE_PROPRE_DEMANDE).toBe("Vous ne pouvez pas décider de votre propre demande : elle doit être traitée par l'exploitation ou la direction");
  });

  it("message adapté au niveau pour les autres rôles", () => {
    const chauffeur = peutDecider({ decideur: p("a", "chauffeur"), demandeur: p("a", "chauffeur"), directionCount: 1 });
    expect(chauffeur.ok === false && chauffeur.raison).toContain("votre manager");
    const expl = peutDecider({ decideur: p("a", "exploitation"), demandeur: p("a", "exploitation"), directionCount: 1 });
    expect(expl.ok === false && expl.raison).toContain("la direction");
    expect(expl.ok === false && expl.raison).not.toContain("l'exploitation ou");
  });

  it("direction unique : peut décider de sa propre demande, auto-validée", () => {
    expect(peutDecider({ decideur: p("d", "direction"), demandeur: p("d", "direction"), directionCount: 1 })).toEqual({ ok: true, autoValidee: true });
  });

  it("direction : count 0 (lecture échouée) est traité comme une direction seule", () => {
    expect(peutDecider({ decideur: p("d", "direction"), demandeur: p("d", "direction"), directionCount: 0 })).toEqual({ ok: true, autoValidee: true });
  });

  it("plusieurs directions : pas d'auto-validation, mais une autre direction peut décider", () => {
    const soi = peutDecider({ decideur: p("d1", "direction"), demandeur: p("d1", "direction"), directionCount: 2 });
    expect(soi.ok).toBe(false);
    expect(soi.ok === false && soi.raison).toContain("une autre personne de la direction");
    expect(peutDecider({ decideur: p("d2", "direction"), demandeur: p("d1", "direction"), directionCount: 2 })).toEqual({ ok: true });
  });

  it("direction unique qui décide pour un autre : pas de mention d'auto-validation", () => {
    expect(peutDecider({ decideur: p("d", "direction"), demandeur: p("m", "manager"), directionCount: 1 })).toEqual({ ok: true });
  });
});

describe("peutDecider : services du manager", () => {
  it("un manager décide pour un chauffeur de ses services", () => {
    expect(peutDecider({ decideur: p("m", "manager", ["s1", "s2"]), demandeur: p("c", "chauffeur", ["s2"]), directionCount: 1 }).ok).toBe(true);
  });
  it("pas pour un chauffeur d'un autre service", () => {
    const v = peutDecider({ decideur: p("m", "manager", ["s1"]), demandeur: p("c", "chauffeur", ["s9"]), directionCount: 1 });
    expect(v).toEqual({ ok: false, raison: "Cette personne n'est pas dans vos services." });
  });
  it("chauffeur sans service : tout manager (comme l'inscription en attente)", () => {
    expect(peutDecider({ decideur: p("m", "manager", ["s1"]), demandeur: p("c", "chauffeur", []), directionCount: 1 }).ok).toBe(true);
  });
  it("services non fournis : non vérifiés (la RLS reste l'autorité)", () => {
    expect(peutDecider({ decideur: p("m", "manager"), demandeur: p("c", "chauffeur", ["s9"]), directionCount: 1 }).ok).toBe(true);
  });
  it("exploitation et direction : pas de limite de services", () => {
    expect(peutDecider({ decideur: p("e", "exploitation", ["s1"]), demandeur: p("c", "chauffeur", ["s9"]), directionCount: 1 }).ok).toBe(true);
    expect(peutDecider({ decideur: p("d", "direction", ["s1"]), demandeur: p("c", "chauffeur", ["s9"]), directionCount: 1 }).ok).toBe(true);
  });
});

describe("peutDecider : comptable", () => {
  it("ne décide pas des demandes opérationnelles", () => {
    const v = peutDecider({ decideur: p("k", "comptable"), demandeur: p("c", "chauffeur"), directionCount: 1 });
    expect(v.ok).toBe(false);
  });
  it("garde ses droits sur la paie, sauf pour lui-même", () => {
    expect(peutDecider({ decideur: p("k", "comptable"), demandeur: p("c", "chauffeur"), directionCount: 1, paie: true }).ok).toBe(true);
    expect(peutDecider({ decideur: p("k", "comptable"), demandeur: p("k", "comptable"), directionCount: 1, paie: true }).ok).toBe(false);
  });
  it("la demande d'un comptable est décidée par la direction seulement", () => {
    expect(peutDecider({ decideur: p("d", "direction"), demandeur: p("k", "comptable"), directionCount: 2 }).ok).toBe(true);
    expect(peutDecider({ decideur: p("e", "exploitation"), demandeur: p("k", "comptable"), directionCount: 2 }).ok).toBe(false);
    expect(peutDecider({ decideur: p("m", "manager"), demandeur: p("k", "comptable"), directionCount: 2 }).ok).toBe(false);
  });
});

describe("destinatairesNotification", () => {
  const u = (id: string, role: string, serviceIds: string[] = [], active = true): UtilisateurOrganisation => ({ id, role, serviceIds, active });
  const ids = (r: { destinataires: UtilisateurOrganisation[] }) => r.destinataires.map((x) => x.id).sort();

  const org = [
    u("c1", "chauffeur", ["s1"]),
    u("c2", "chauffeur", ["s2"]),
    u("m1", "manager", ["s1"]),
    u("m2", "manager", ["s2"]),
    u("m3", "manager", ["s1"]),
    u("e1", "exploitation"),
    u("d1", "direction"),
    u("d2", "direction"),
    u("k1", "comptable"),
  ];

  it("chauffeur : les managers de son service, personne d'autre", () => {
    const r = destinatairesNotification(p("c1", "chauffeur", ["s1"]), org);
    expect(ids(r)).toEqual(["m1", "m3"]);
    expect(r.niveau).toBe("manager");
    expect(r.escalade).toBe(false);
  });

  it("manager : exploitation et direction, jamais un autre manager ni lui-même", () => {
    const r = destinatairesNotification(p("m1", "manager", ["s1"]), org);
    expect(ids(r)).toEqual(["d1", "d2", "e1"]);
    expect(r.roles.sort()).toEqual(["direction", "exploitation"]);
    expect(r.escalade).toBe(false);
  });

  it("exploitation : la direction", () => {
    expect(ids(destinatairesNotification(p("e1", "exploitation"), org))).toEqual(["d1", "d2"]);
  });

  it("direction : les autres membres de la direction (pas lui-même)", () => {
    expect(ids(destinatairesNotification(p("d1", "direction"), org))).toEqual(["d2"]);
  });

  it("direction unique : personne à prévenir", () => {
    const r = destinatairesNotification(p("d1", "direction"), org.filter((x) => x.id !== "d2"));
    expect(r.destinataires).toEqual([]);
    expect(r.niveau).toBeNull();
  });

  it("comptable : la direction", () => {
    expect(ids(destinatairesNotification(p("k1", "comptable"), org))).toEqual(["d1", "d2"]);
  });

  it("escalade : pas de manager dans le service du chauffeur → l'exploitation", () => {
    const r = destinatairesNotification(p("c2", "chauffeur", ["s2"]), org.filter((x) => x.id !== "m2"));
    expect(ids(r)).toEqual(["e1"]);
    expect(r.niveau).toBe("exploitation");
    expect(r.escalade).toBe(true);
  });

  it("escalade : ni manager ni exploitation → la direction", () => {
    const r = destinatairesNotification(p("c1", "chauffeur", ["s1"]), org.filter((x) => !["m1", "m2", "m3", "e1"].includes(x.id)));
    expect(ids(r)).toEqual(["d1", "d2"]);
    expect(r.niveau).toBe("direction");
    expect(r.escalade).toBe(true);
  });

  it("manager sans exploitation → la direction seule", () => {
    const r = destinatairesNotification(p("m1", "manager", ["s1"]), org.filter((x) => x.id !== "e1"));
    expect(ids(r)).toEqual(["d1", "d2"]);
    expect(r.roles).toEqual(["direction"]);
  });

  it("manager : un autre manager n'est jamais prévenu même s'il est seul au-dessus", () => {
    const r = destinatairesNotification(p("m1", "manager", ["s1"]), [u("m1", "manager", ["s1"]), u("m2", "manager", ["s1"])]);
    expect(r.destinataires).toEqual([]);
  });

  it("chauffeur sans service : tous les managers", () => {
    expect(ids(destinatairesNotification(p("c9", "chauffeur", []), org))).toEqual(["m1", "m2", "m3"]);
  });

  it("les comptes désactivés ne sont jamais destinataires (escalade comprise)", () => {
    const r = destinatairesNotification(p("c1", "chauffeur", ["s1"]), [u("m1", "manager", ["s1"], false), u("e1", "exploitation", [], false), u("d1", "direction")]);
    expect(ids(r)).toEqual(["d1"]);
    expect(r.escalade).toBe(true);
  });

  it("le demandeur n'est jamais destinataire de sa propre demande, quel que soit son rôle", () => {
    for (const r of ["chauffeur", "manager", "exploitation", "direction", "comptable"]) {
      const dem = u("moi", r, ["s1"]);
      const res = destinatairesNotification(dem, [dem, ...org]);
      expect(res.destinataires.some((x) => x.id === "moi")).toBe(false);
    }
  });

  it("l'ancien rôle manager_chauffeur compte comme manager (destinataire et demandeur)", () => {
    expect(ids(destinatairesNotification(p("c1", "chauffeur", ["s1"]), [u("mc", "manager_chauffeur", ["s1"])]))).toEqual(["mc"]);
    expect(ids(destinatairesNotification(p("mc", "manager_chauffeur", ["s1"]), org))).toEqual(["d1", "d2", "e1"]);
  });
});

describe("libellés", () => {
  it("En attente de … selon le demandeur", () => {
    expect(libelleEnAttente("chauffeur")).toBe("En attente du manager");
    expect(libelleEnAttente("manager")).toBe("En attente de l'exploitation");
    expect(libelleEnAttente("exploitation")).toBe("En attente de la direction");
    expect(libelleEnAttente("comptable")).toBe("En attente de la direction");
  });
  it("reflète l'escalade quand un niveau est vide", () => {
    expect(libelleEnAttente("manager", { exploitation: 0, direction: 1 })).toBe("En attente de la direction");
    expect(libelleEnAttente("chauffeur", { manager: 0, exploitation: 2, direction: 1 })).toBe("En attente de l'exploitation");
    expect(libelleEnAttente("chauffeur", { manager: 0, exploitation: 0, direction: 1 })).toBe("En attente de la direction");
    expect(libelleEnAttente("chauffeur", { manager: 3, exploitation: 1, direction: 1 })).toBe("En attente du manager");
  });
  it("direction : autre membre, ou sa propre validation si seule", () => {
    expect(libelleEnAttente("direction")).toBe("En attente d'une autre personne de la direction");
    expect(libelleEnAttente("direction", { direction: 3 })).toBe("En attente d'une autre personne de la direction");
    expect(libelleEnAttente("direction", { direction: 1 })).toBe("En attente de votre validation (direction unique)");
  });
  it("À décider par …", () => {
    expect(libelleADecider("manager")).toBe("À décider par l'exploitation ou la direction");
    expect(libelleADecider("exploitation")).toBe("À décider par la direction");
    expect(libelleADecider("chauffeur")).toBe("À décider par le manager, l'exploitation ou la direction");
    expect(libelleADecider("direction")).toBe("À décider par une autre personne de la direction");
  });
});

describe("droitsDecision (écrans)", () => {
  it("sa propre demande : lecture seule avec mention", () => {
    const d = droitsDecision({ moi: p("m", "manager"), demandeur: p("m", "manager"), directionCount: 2 });
    expect(d.peutDecider).toBe(false);
    expect(d.mention).toBe("Votre demande — à décider par l'exploitation ou la direction");
  });
  it("demande d'un pair : lecture seule", () => {
    const d = droitsDecision({ moi: p("m1", "manager"), demandeur: p("m2", "manager"), directionCount: 2 });
    expect(d).toEqual({ peutDecider: false, autoValidee: false, mention: "À décider par l'exploitation ou la direction" });
  });
  it("demande d'un chauffeur : boutons actifs", () => {
    expect(droitsDecision({ moi: p("m", "manager"), demandeur: p("c", "chauffeur"), directionCount: 2 })).toEqual({ peutDecider: true, autoValidee: false, mention: null });
  });
  it("direction unique : peut décider la sienne, signalée comme auto-validation", () => {
    expect(droitsDecision({ moi: p("d", "direction"), demandeur: p("d", "direction"), directionCount: 1 })).toEqual({ peutDecider: true, autoValidee: true, mention: null });
  });
});
