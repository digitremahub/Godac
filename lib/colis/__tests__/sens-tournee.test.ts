import { describe, expect, it } from "vitest";
import {
  ACCORD_MIN,
  HISTORIQUE_MAX,
  LAMBDA_MAX,
  LAMBDA_SENS,
  ajouterObservation,
  apprendreSens,
  biaisSansRisque,
  cleSecteur,
  coutBiaise,
  desordre,
  lambdaBorne,
  libelleSens,
  lireHistorique,
  lireMode,
  orientationAutourDepot,
  ordonnerSelonReference,
  ordreObserve,
  portee,
  referenceSens,
  resumeHabitude,
  type ObservationSens,
  type Secteur,
} from "@/lib/colis/sens-tournee";

const s = (nom: string): Secteur => ({ cle: cleSecteur(nom), nom });
const obs = (run_id: string, date: string, ...noms: string[]): ObservationSens => ({ run_id, date, ordre: noms.map(s) });

describe("cleSecteur / lireMode / portee", () => {
  it("normalise les noms de secteurs (casse, accents, ponctuation)", () => {
    expect(cleSecteur("  Saint-Médard-en-Jalles ")).toBe("saint medard en jalles");
    expect(cleSecteur("SOULAC")).toBe(cleSecteur("soulac"));
  });
  it("mode inconnu : habituel", () => {
    expect(lireMode("inverse")).toBe("inverse");
    expect(lireMode("libre")).toBe("libre");
    expect(lireMode("nimporte")).toBe("habituel");
    expect(lireMode(undefined)).toBe("habituel");
  });
  it("portée : le modèle de tournée d'abord, sinon chauffeur + service", () => {
    expect(portee({ route_id: "r1", driver_id: "d1", service_id: "s1" })).toBe("route:r1");
    expect(portee({ route_id: null, driver_id: "d1", service_id: "s1" })).toBe("chauffeur:d1:service:s1");
    expect(portee({ driver_id: "d1", service_id: null })).toBe("chauffeur:d1:service:-");
    expect(portee({})).toBeNull();
  });
});

describe("ordreObserve : l'ordre effectif des secteurs d'une tournée réalisée", () => {
  const listes = [
    { id: "L1", name: "Soulac" },
    { id: "L2", name: "Vendays" },
    { id: "L3", name: "Hourtin" },
    { id: "LR", name: "Reportés" },
  ];
  const a = (list_id: string, hh: number, mm = 0, status = "delivered") => ({ list_id, status, done_at: `2026-10-20T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z` });

  it("trie les secteurs par heure médiane de clôture", () => {
    const arrets = [a("L3", 14), a("L1", 8), a("L2", 10), a("L1", 9), a("L3", 15), a("L2", 11)];
    expect(ordreObserve(arrets, listes).map((x) => x.nom)).toEqual(["Soulac", "Vendays", "Hourtin"]);
  });
  it("ignore les arrêts non clôturés, sans liste ou sans heure, et les listes exclues", () => {
    const arrets = [a("L1", 8), a("L2", 9, 0, "pending"), { list_id: null, status: "delivered", done_at: "2026-10-20T10:00:00Z" }, { list_id: "L3", status: "delivered", done_at: null }, a("LR", 12)];
    expect(ordreObserve(arrets, listes, (l) => l.name === "Reportés").map((x) => x.nom)).toEqual(["Soulac"]);
  });
  it("un échec clôturé compte comme un passage ; un secteur revisité en fin de journée garde sa place médiane", () => {
    const arrets = [a("L1", 8), a("L1", 8, 30), a("L1", 16), a("L2", 10, 0, "failed"), a("L2", 11)];
    expect(ordreObserve(arrets, listes).map((x) => x.nom)).toEqual(["Soulac", "Vendays"]);
  });
  it("deux listes de même nom ne font qu'un secteur", () => {
    const r = ordreObserve([a("A", 8), a("B", 9)], [{ id: "A", name: "Soulac" }, { id: "B", name: "SOULAC" }]);
    expect(r).toHaveLength(1);
  });
});

describe("historique", () => {
  it("ajouterObservation : idempotent pour une même tournée, les plus récentes d'abord, borné", () => {
    let h: ObservationSens[] = [];
    h = ajouterObservation(h, obs("r1", "2026-10-01", "A", "B"));
    h = ajouterObservation(h, obs("r1", "2026-10-01", "A", "B"));
    expect(h).toHaveLength(1);
    h = ajouterObservation(h, obs("r1", "2026-10-01", "B", "A")); // la même tournée remplace sa ligne
    expect(h).toHaveLength(1);
    expect(h[0]!.ordre[0]!.nom).toBe("B");
    for (let i = 2; i <= HISTORIQUE_MAX + 4; i++) h = ajouterObservation(h, obs(`r${i}`, `2026-10-${String(i).padStart(2, "0")}`, "A", "B"));
    expect(h).toHaveLength(HISTORIQUE_MAX);
    expect(h[0]!.date > h[h.length - 1]!.date).toBe(true);
  });
  it("une observation d'un seul secteur n'apprend rien", () => {
    expect(ajouterObservation([], obs("r1", "2026-10-01", "A"))).toEqual([]);
  });
  it("lireHistorique rejette le JSON douteux", () => {
    const bon = obs("r1", "2026-10-01", "A", "B");
    expect(lireHistorique([bon, { run_id: 1 }, null, { run_id: "x", date: "pas une date", ordre: [] }, { run_id: "y", date: "2026-10-02", ordre: [{ cle: "a", nom: "A" }] }])).toEqual([bon]);
    expect(lireHistorique("n'importe quoi")).toEqual([]);
    expect(lireHistorique(undefined)).toEqual([]);
  });
});

describe("apprendreSens", () => {
  it("pas d'habitude avec moins de deux tournées", () => {
    expect(apprendreSens([])).toBeNull();
    expect(apprendreSens([obs("r1", "2026-10-02", "Soulac", "Vendays", "Hourtin")])).toBeNull();
  });

  it("deux tournées identiques : le sens est retenu, avec les noms affichables", () => {
    const h = apprendreSens([obs("r2", "2026-10-09", "Soulac", "Vendays", "Hourtin"), obs("r1", "2026-10-02", "Soulac", "Vendays", "Hourtin")]);
    expect(h?.ordre.map((x) => x.nom)).toEqual(["Soulac", "Vendays", "Hourtin"]);
    expect(h?.observations).toBe(2);
    expect(h?.accord).toBe(1);
  });

  it("une tournée où un secteur manque ne perturbe pas l'ordre des autres", () => {
    const h = apprendreSens([obs("r3", "2026-10-16", "Soulac", "Hourtin"), obs("r2", "2026-10-09", "Soulac", "Vendays", "Hourtin"), obs("r1", "2026-10-02", "Soulac", "Vendays", "Hourtin")]);
    expect(h?.ordre.map((x) => x.nom)).toEqual(["Soulac", "Vendays", "Hourtin"]);
  });

  it("un secteur vu une seule fois (exceptionnel) n'entre pas dans l'habitude", () => {
    const h = apprendreSens([obs("r2", "2026-10-09", "Soulac", "Hourtin", "Lesparre"), obs("r1", "2026-10-02", "Soulac", "Hourtin")]);
    expect(h?.ordre.map((x) => x.nom)).toEqual(["Soulac", "Hourtin"]);
  });

  it("des tournées qui se contredisent ne font pas une habitude", () => {
    expect(apprendreSens([obs("r2", "2026-10-09", "A", "B"), obs("r1", "2026-10-02", "B", "A")])).toBeNull();
  });

  it("les tournées récentes pèsent davantage : le sens change quand les habitudes changent", () => {
    const h = apprendreSens([
      obs("r5", "2026-10-30", "B", "A"),
      obs("r4", "2026-10-23", "B", "A"),
      obs("r3", "2026-10-16", "B", "A"),
      obs("r2", "2026-10-09", "A", "B"),
      obs("r1", "2026-10-02", "A", "B"),
    ]);
    expect(h?.ordre.map((x) => x.nom)).toEqual(["B", "A"]);
    expect(h!.accord).toBeGreaterThanOrEqual(ACCORD_MIN);
  });

  it("« Oublier l'habitude » : seules les tournées postérieures à la date d'oubli comptent", () => {
    const hist = [obs("r3", "2026-10-20", "A", "B"), obs("r2", "2026-10-09", "A", "B"), obs("r1", "2026-10-02", "A", "B")];
    expect(apprendreSens(hist, "2026-10-09")).toBeNull(); // une seule tournée après l'oubli
    expect(apprendreSens(hist, "2026-10-01")?.observations).toBe(3);
    expect(apprendreSens([...hist, obs("r4", "2026-10-27", "B", "A")], "2026-10-15")).toBeNull(); // 2 tournées, contradictoires
  });

  it("garde le nom affiché de la tournée la plus récente", () => {
    const recent = { run_id: "r2", date: "2026-10-09", ordre: [{ cle: "soulac", nom: "SOULAC" }, s("Hourtin")] };
    const ancien = { run_id: "r1", date: "2026-10-02", ordre: [{ cle: "soulac", nom: "Soulac" }, s("Hourtin")] };
    expect(apprendreSens([recent, ancien])?.ordre[0]!.nom).toBe("SOULAC");
  });
});

describe("mode et référence", () => {
  const habitude = apprendreSens([obs("r2", "2026-10-09", "Soulac", "Vendays", "Hourtin"), obs("r1", "2026-10-02", "Soulac", "Vendays", "Hourtin")]);
  it("habituel / inverse / libre", () => {
    expect(referenceSens(habitude, "habituel")).toEqual(["soulac", "vendays", "hourtin"]);
    expect(referenceSens(habitude, "inverse")).toEqual(["hourtin", "vendays", "soulac"]);
    expect(referenceSens(habitude, "libre")).toBeNull();
    expect(referenceSens(null, "habituel")).toBeNull();
  });
  it("l'inverse ne modifie pas l'habitude", () => {
    referenceSens(habitude, "inverse");
    expect(habitude!.ordre.map((x) => x.cle)).toEqual(["soulac", "vendays", "hourtin"]);
  });
});

describe("desordre", () => {
  const ref = ["a", "b", "c", "d"];
  it("0 quand l'ordre est celui de l'habitude, 1 quand il est inverse", () => {
    expect(desordre(["a", "b", "c", "d"], ref)).toBe(0);
    expect(desordre(["d", "c", "b", "a"], ref)).toBe(1);
  });
  it("part des paires inversées", () => {
    expect(desordre(["b", "a", "c", "d"], ref)).toBeCloseTo(1 / 6);
  });
  it("ignore les secteurs inconnus de l'habitude ; moins de deux communs : 0", () => {
    expect(desordre(["a", "x", "b", "y"], ref)).toBe(0);
    expect(desordre(["x", "a", "y"], ref)).toBe(0);
    expect(desordre([], ref)).toBe(0);
  });
});

describe("coutBiaise : un biais doux et borné", () => {
  it("sans désordre, le coût est la longueur", () => {
    expect(coutBiaise(100, 0)).toBe(100);
  });
  it("majore la longueur d'au plus λ (4 %) pour un désordre total", () => {
    expect(coutBiaise(100, 1)).toBeCloseTo(100 * (1 + LAMBDA_SENS));
    expect(coutBiaise(100, 0.5)).toBeCloseTo(100 * (1 + LAMBDA_SENS / 2));
  });
  it("λ est borné : jamais négatif, jamais au-delà de 10 %", () => {
    expect(lambdaBorne(5)).toBe(LAMBDA_MAX);
    expect(lambdaBorne(-1)).toBe(0);
    expect(lambdaBorne(Number.NaN)).toBe(LAMBDA_SENS);
    expect(coutBiaise(100, 1, 5)).toBeCloseTo(100 * (1 + LAMBDA_MAX));
    expect(coutBiaise(100, 1, -3)).toBe(100);
  });
  it("le désordre est lui-même borné entre 0 et 1", () => {
    expect(coutBiaise(100, 7)).toBeCloseTo(100 * (1 + LAMBDA_SENS));
    expect(coutBiaise(100, -2)).toBe(100);
  });
  it("à longueur égale, l'ordre habituel est strictement moins cher (départage)", () => {
    expect(coutBiaise(50, 0)).toBeLessThan(coutBiaise(50, 0.3));
  });
  it("un détour supérieur à λ n'est jamais compensé par l'habitude", () => {
    expect(coutBiaise(110, 0)).toBeGreaterThan(coutBiaise(100, 1));
  });
});

describe("ordonnerSelonReference", () => {
  it("range les éléments connus selon l'habitude et insère le nouveau là où il coûte le moins", () => {
    const items = ["hourtin", "nouveau", "soulac", "vendays"];
    // Coût : distance fictive = position du nouveau souhaitée entre vendays et hourtin.
    const cout = (o: string[]) => Math.abs(o.indexOf("nouveau") - 2);
    expect(ordonnerSelonReference(items, (x) => x, ["soulac", "vendays", "hourtin"], cout)).toEqual(["soulac", "vendays", "nouveau", "hourtin"]);
  });
  it("sans élément inconnu, suit exactement la référence", () => {
    expect(ordonnerSelonReference(["c", "a", "b"], (x) => x, ["a", "b", "c"], () => 0)).toEqual(["a", "b", "c"]);
  });
});

describe("biaisSansRisque : les horaires passent avant l'habitude", () => {
  const base = { hors: 0, ecartes: 0, fin: 600 };
  it("accepte un biais qui ne change rien aux horaires", () => {
    expect(biaisSansRisque(base, { ...base, fin: 605 })).toBe(true);
  });
  it("refuse un biais qui crée un hors-horaires ou écarte une adresse de plus", () => {
    expect(biaisSansRisque(base, { ...base, hors: 1 })).toBe(false);
    expect(biaisSansRisque(base, { ...base, ecartes: 1 })).toBe(false);
  });
  it("accepte un biais qui n'aggrave pas un hors-horaires déjà inévitable", () => {
    expect(biaisSansRisque({ ...base, hors: 2 }, { ...base, hors: 2 })).toBe(true);
    expect(biaisSansRisque({ ...base, hors: 2 }, { ...base, hors: 3 })).toBe(false);
  });
  it("refuse un biais qui retarde la fin de plus de 10 minutes", () => {
    expect(biaisSansRisque(base, { ...base, fin: 611 })).toBe(false);
    expect(biaisSansRisque(base, { ...base, fin: 610 })).toBe(true);
  });
  it("fin inconnue : seuls les horaires comptent", () => {
    expect(biaisSansRisque({ hors: 0, ecartes: 0, fin: null }, { hors: 0, ecartes: 0, fin: 900 })).toBe(true);
  });
});

describe("affichage", () => {
  it("« Soulac → Vendays → Hourtin »", () => {
    expect(libelleSens([s("Soulac"), s("Vendays"), s("Hourtin")])).toBe("Soulac → Vendays → Hourtin");
  });
  it("une longue suite est abrégée mais garde le dernier secteur", () => {
    expect(libelleSens(["A", "B", "C", "D", "E", "F", "G"].map(s))).toBe("A → B → C → D → … → G");
  });
  it("résumé de l'encart", () => {
    const h = apprendreSens([obs("r2", "2026-10-09", "Soulac", "Vendays"), obs("r1", "2026-10-02", "Soulac", "Vendays")])!;
    expect(resumeHabitude(h)).toBe("Sens habituel : Soulac → Vendays");
    expect(resumeHabitude(h, "horaire")).toBe("Sens habituel : Soulac → Vendays (sens horaire autour du dépôt)");
  });
});

describe("orientationAutourDepot", () => {
  const depot = { lat: 45, lng: 5 };
  const sur = (angleDeg: number) => ({ lat: 45 + 0.1 * Math.sin((angleDeg * Math.PI) / 180), lng: 5 + (0.1 * Math.cos((angleDeg * Math.PI) / 180)) / Math.cos((45 * Math.PI) / 180) });
  it("antihoraire : nord-est → nord-ouest → sud-ouest", () => {
    expect(orientationAutourDepot(depot, [sur(45), sur(135), sur(225)])).toBe("antihoraire");
  });
  it("horaire : l'inverse", () => {
    expect(orientationAutourDepot(depot, [sur(225), sur(135), sur(45)])).toBe("horaire");
  });
  it("trop peu de secteurs ou rotation insignifiante : null", () => {
    expect(orientationAutourDepot(depot, [sur(45), sur(135)])).toBeNull();
    expect(orientationAutourDepot(depot, [sur(40), sur(50), sur(60)])).toBeNull();
  });
});
