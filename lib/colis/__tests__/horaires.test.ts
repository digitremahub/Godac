import { describe, expect, it } from "vitest";
import {
  PRESETS,
  afficherHeure,
  dateParis,
  fenetresArret,
  heureDepart,
  instantParis,
  jourIso,
  libelleFenetres,
  lireHeure,
  minutesParis,
  normaliserSemaine,
  ordonnerAvecHoraires,
  passagesTournee,
  resumeSemaine,
  servir,
  simulerPassages,
  type Fenetres,
} from "@/lib/colis/horaires";
import { optimiserOrdre, type Point } from "@/lib/colis/optimisation";
import { sequenceParListes } from "@/lib/colis/listes";
import { estimerAvancement, minutesTrajet } from "@/lib/colis/estimation";
import { distanceKm } from "@/lib/colis/optimisation";

const depot: Point = { lat: 45.75, lng: 4.85 };
/** Point à `km` à l'est du dépôt (même latitude). */
const est = (km: number): Point => ({ lat: 45.75, lng: 4.85 + km / (111.32 * Math.cos((45.75 * Math.PI) / 180)) });
const h = (x: string) => lireHeure(x)!;

describe("lecture et normalisation des horaires", () => {
  it("lit les heures saisies ou stockées", () => {
    expect(lireHeure("08:00")).toBe(480);
    expect(lireHeure("8:30")).toBe(510);
    expect(lireHeure("14:00:00")).toBe(840);
    expect(lireHeure("8h")).toBe(480);
    expect(lireHeure("8 h 15")).toBe(495);
    expect(lireHeure("24:00")).toBe(1440);
    expect(lireHeure("25:00")).toBeNull();
    expect(lireHeure("midi")).toBeNull();
    expect(lireHeure(null)).toBeNull();
    expect(afficherHeure(480)).toBe("8:00");
    expect(afficherHeure(1450)).toBe("0:10");
  });

  it("normalise une semaine : tri, fusion, 2 créneaux au plus, jour fermé, jours inconnus ignorés", () => {
    const s = normaliserSemaine({
      "1": [
        { open: "14:00", close: "18:00" },
        { open: "08:00", close: "12:00" },
      ],
      "2": [
        { open: "08:00", close: "12:00" },
        { open: "11:00", close: "13:00" },
      ],
      "3": [
        { open: "08:00", close: "09:00" },
        { open: "10:00", close: "11:00" },
        { open: "12:00", close: "13:00" },
      ],
      "4": [{ open: "12:00", close: "08:00" }],
      "6": [],
      "8": [{ open: "08:00", close: "12:00" }],
      x: "n'importe quoi",
    });
    expect(s["1"]).toEqual([
      { open: "08:00", close: "12:00" },
      { open: "14:00", close: "18:00" },
    ]);
    expect(s["2"]).toEqual([{ open: "08:00", close: "13:00" }]);
    expect(s["3"]).toHaveLength(2);
    expect(s["4"]).toEqual([]);
    expect(s["5"]).toBeUndefined();
    expect(s["6"]).toEqual([]);
    expect(Object.keys(s)).not.toContain("8");
    expect(normaliserSemaine(null)).toEqual({});
    expect(normaliserSemaine([1, 2])).toEqual({});
  });

  it("préréglages : coupure du lundi au vendredi, journée continue, week-end fermé", () => {
    let s = PRESETS.find((p) => p.cle === "coupure")!.appliquer({});
    s = PRESETS.find((p) => p.cle === "samedi")!.appliquer(s);
    s = PRESETS.find((p) => p.cle === "dimanche")!.appliquer(s);
    expect(s["5"]).toHaveLength(2);
    expect(s["6"]).toEqual([]);
    expect(resumeSemaine(s)).toBe("Lun–Ven 8:00–12:00 · 14:00–18:00 · Sam, Dim fermé");
    const c = PRESETS.find((p) => p.cle === "continue")!.appliquer(s);
    expect(c["1"]).toEqual([{ open: "08:00", close: "18:00" }]);
    expect(c["7"]).toEqual([]);
  });
});

describe("jour et heure de Paris (changements d'heure)", () => {
  it("jour ISO d'une date", () => {
    expect(jourIso("2026-10-12")).toBe(1); // lundi
    expect(jourIso("2026-10-18")).toBe(7); // dimanche
  });

  it("jour de la semaine à Paris juste après minuit, été comme hiver", () => {
    // 29 mars 2026 : passage à l'heure d'été (UTC+2). 22:30 UTC le 29 = 00:30 le lundi 30 à Paris.
    expect(dateParis(new Date("2026-03-29T22:30:00Z"))).toBe("2026-03-30");
    expect(jourIso(dateParis(new Date("2026-03-29T22:30:00Z")))).toBe(1);
    // Avant le changement (UTC+1) : 23:30 UTC le 28 = 00:30 le dimanche 29.
    expect(jourIso(dateParis(new Date("2026-03-28T23:30:00Z")))).toBe(7);
    // 25 octobre 2026 : retour à l'heure d'hiver. 23:30 UTC le 25 = 00:30 le lundi 26.
    expect(jourIso(dateParis(new Date("2026-10-25T23:30:00Z")))).toBe(1);
    // Mais 22:30 UTC le 25 = 23:30 le dimanche.
    expect(jourIso(dateParis(new Date("2026-10-25T22:30:00Z")))).toBe(7);
    expect(minutesParis(new Date("2026-10-25T22:30:00Z"))).toBe(23 * 60 + 30);
  });

  it("instant d'une heure de Paris un jour de changement d'heure", () => {
    expect(instantParis("2026-03-29", 8 * 60).toISOString()).toBe("2026-03-29T06:00:00.000Z");
    expect(instantParis("2026-03-28", 8 * 60).toISOString()).toBe("2026-03-28T07:00:00.000Z");
    expect(instantParis("2026-10-25", 8 * 60).toISOString()).toBe("2026-10-25T07:00:00.000Z");
    expect(instantParis("2026-07-01", 18 * 60 + 30).toISOString()).toBe("2026-07-01T16:30:00.000Z");
  });
});

describe("fenêtres d'un arrêt", () => {
  const semaine = PRESETS[0]!.appliquer({ "6": [] });

  it("créneaux du jour depuis l'annuaire, fermé, sans contrainte", () => {
    expect(fenetresArret({ semaine }, "2026-10-13")).toEqual([
      [480, 720],
      [840, 1080],
    ]); // mardi
    expect(fenetresArret({ semaine }, "2026-10-17")).toEqual([]); // samedi fermé
    expect(fenetresArret({ semaine }, "2026-10-18")).toBeNull(); // dimanche non renseigné
    expect(fenetresArret({}, "2026-10-13")).toBeNull();
  });

  it("le créneau ponctuel de l'arrêt l'emporte sur l'annuaire", () => {
    expect(fenetresArret({ semaine, fin: "10:00:00" }, "2026-10-17")).toEqual([[0, 600]]);
    expect(fenetresArret({ semaine, debut: "14:00" }, "2026-10-13")).toEqual([[840, 1440]]);
    expect(fenetresArret({ debut: "09:00", fin: "11:00" }, "2026-10-13")).toEqual([[540, 660]]);
  });

  it("badges", () => {
    expect(libelleFenetres([[480, 720], [840, 1080]])).toBe("Ouvert 8:00–12:00 · 14:00–18:00");
    expect(libelleFenetres([])).toBe("Fermé aujourd'hui");
    expect(libelleFenetres(null)).toBeNull();
    expect(libelleFenetres([[0, 600]], true)).toBe("Avant 10:00");
    expect(libelleFenetres([[840, 1440]], true)).toBe("À partir de 14:00");
    expect(libelleFenetres([[540, 660]], true)).toBe("Créneau 9:00–11:00");
  });
});

describe("heures de passage", () => {
  const coupure: Fenetres = [
    [480, 720],
    [840, 1080],
  ];

  it("attente à l'ouverture, pause de midi, après la fermeture", () => {
    expect(servir(450, coupure)).toEqual({ debut: 480, statut: "ok", retard: 0 });
    expect(servir(600, coupure)).toEqual({ debut: 600, statut: "ok", retard: 0 });
    // Arrivée pendant la pause de midi : on attend 14:00.
    expect(servir(750, coupure)).toEqual({ debut: 840, statut: "ok", retard: 0 });
    expect(servir(1100, coupure)).toEqual({ debut: 1100, statut: "hors", retard: 20 });
    expect(servir(600, [])).toMatchObject({ statut: "ferme" });
    expect(servir(600, null)).toMatchObject({ statut: "libre" });
  });

  it("même modèle de trajet que l'estimation (35 km/h × 1,3) + 3 min par arrêt", () => {
    const a = est(10);
    const { passages, fin } = simulerPassages({ point: depot, minute: 420 }, [{ point: a, fenetres: coupure }]);
    const trajet = minutesTrajet(distanceKm(depot, a));
    expect(trajet).toBeCloseTo(22.3, 0);
    expect(passages[0]!.arrivee).toBeCloseTo(420 + trajet);
    expect(passages[0]!.debut).toBe(480);
    expect(passages[0]!.attente).toBeCloseTo(60 - trajet);
    expect(fin).toBe(483);
  });

  it("passagesTournee : seulement les arrêts restants, dans l'ordre affiché", () => {
    const m = passagesTournee(
      [
        { id: "fait", status: "delivered", lat: 45.75, lng: 4.9, fenetres: null },
        { id: "a", status: "pending", lat: est(1).lat, lng: est(1).lng, fenetres: null },
        { id: "b", status: "pending", lat: null, lng: null, fenetres: [[600, 700]] },
      ],
      { point: depot, minute: 480 },
    );
    expect([...m.keys()]).toEqual(["a", "b"]);
    expect(m.get("b")!.debut).toBe(600);
  });

  it("heure de départ : prévue (08:00 par défaut), jamais avant maintenant le jour même, maintenant en route", () => {
    const matin = new Date("2026-10-13T05:00:00Z"); // 7:00 à Paris
    expect(heureDepart({ status: "loading", run_date: "2026-10-13" }, matin)).toEqual({ jour: "2026-10-13", minute: 480 });
    expect(heureDepart({ status: "loading", run_date: "2026-10-13", planned_start: "06:30:00" }, matin)).toEqual({ jour: "2026-10-13", minute: 420 });
    expect(heureDepart({ status: "loading", run_date: "2026-10-14", planned_start: "06:30" }, matin)).toEqual({ jour: "2026-10-14", minute: 390 });
    expect(heureDepart({ status: "in_progress", run_date: "2026-10-13" }, matin)).toEqual({ jour: "2026-10-13", minute: 420 });
    expect(heureDepart({ status: "loading", run_date: "2026-10-13" }, matin, true)).toEqual({ jour: "2026-10-13", minute: 420 });
  });
});

describe("ordre de passage avec horaires", () => {
  const pts = [est(2), est(4), est(6), est(8)];

  it("sans horaires : exactement l'ordre habituel", () => {
    const arrets = [est(5), est(1), est(3), { lat: 45.76, lng: 4.86 }].map((point) => ({ point, fenetres: null }));
    const r = ordonnerAvecHoraires(depot, arrets, { debut: 480 });
    expect(r.ordre).toEqual(optimiserOrdre(depot, arrets.map((a) => a.point)));
    expect(r.fermes).toEqual([]);
  });

  it("« avant 10 h » au bout de la ligne : servi en premier plutôt qu'en retard", () => {
    // Boucle aller-retour sur une ligne, départ 9:40 : l'ordre habituel
    // (2, 4, 6, 8 km) arriverait au point à 8 km vers 10:07, trop tard.
    const arrets = pts.map((point, i) => ({ point, fenetres: (i === 3 ? [[0, 600]] : null) as Fenetres }));
    const habituel = optimiserOrdre(depot, pts);
    const avant = simulerPassages({ point: depot, minute: 580 }, habituel.map((k) => arrets[k]!));
    expect(avant.passages.some((p) => p.statut === "hors")).toBe(true);
    const r = ordonnerAvecHoraires(depot, arrets, { debut: 580 });
    expect(r.ordre[0]).toBe(3);
    const sim = simulerPassages(
      { point: depot, minute: 580 },
      r.ordre.map((k) => arrets[k]!),
    );
    const k = r.ordre.indexOf(3);
    expect(sim.passages[k]!.statut).toBe("ok");
    expect(sim.passages.every((p) => p.statut !== "hors")).toBe(true);
  });

  it("ouverture à 14 h : on ne vient pas attendre le matin, on passe en fin de tournée", () => {
    // Départ 13:00 ; l'arrêt proche n'ouvre qu'à 14:00 : le mettre en premier coûterait ~50 min d'attente.
    const arrets = [
      { point: est(1), fenetres: [[840, 1080]] as Fenetres },
      { point: est(3), fenetres: null },
      { point: est(5), fenetres: null },
      { point: est(7), fenetres: null },
    ];
    const r = ordonnerAvecHoraires(depot, arrets, { debut: 780 });
    const sim = simulerPassages({ point: depot, minute: 780 }, r.ordre.map((k) => arrets[k]!));
    const total = sim.passages.reduce((n, p) => n + p.attente, 0);
    const naif = simulerPassages({ point: depot, minute: 780 }, [0, 1, 2, 3].map((k) => arrets[k]!));
    expect(sim.fin).toBeLessThan(naif.fin);
    expect(total).toBeLessThan(naif.passages.reduce((n, p) => n + p.attente, 0));
    expect(r.ordre[0]).not.toBe(0);
  });

  it("attendre quelques minutes coûte moins qu'un détour : on attend", () => {
    // Départ 7:50, premier arrêt (ouvre à 8:00) sur le chemin : ~4 min d'attente plutôt qu'un aller-retour.
    const arrets = [
      { point: est(2), fenetres: [[480, 720]] as Fenetres },
      { point: est(20), fenetres: null },
      { point: est(22), fenetres: null },
    ];
    const r = ordonnerAvecHoraires(depot, arrets, { debut: 470, retour: false });
    expect(r.ordre).toEqual([0, 1, 2]);
    const sim = simulerPassages({ point: depot, minute: 470 }, r.ordre.map((k) => arrets[k]!));
    expect(sim.passages[0]!.attente).toBeGreaterThan(0);
    expect(sim.passages[0]!.statut).toBe("ok");
  });

  it("pause de midi : un arrêt fermé de 12 h à 14 h n'est pas placé pendant la pause", () => {
    // Départ 11:40 : l'arrêt à 8 km (8:00–12:00 / 14:00–18:00) servi avant midi plutôt qu'à 12:xx.
    const arrets = pts.map((point, i) => ({
      point,
      fenetres: (i === 3
        ? [
            [480, 720],
            [840, 1080],
          ]
        : null) as Fenetres,
    }));
    const r = ordonnerAvecHoraires(depot, arrets, { debut: 700 });
    const sim = simulerPassages({ point: depot, minute: 700 }, r.ordre.map((k) => arrets[k]!));
    const p = sim.passages[r.ordre.indexOf(3)]!;
    expect(p.statut).toBe("ok");
    expect(p.attente).toBeLessThan(30);
  });

  it("fermé aujourd'hui ou déjà fermé à l'arrivée : en fin de liste et signalé", () => {
    const arrets = [
      { point: est(1), fenetres: [] as Fenetres },
      { point: est(2), fenetres: [[480, 540]] as Fenetres },
      { point: est(3), fenetres: null },
      { point: est(4), fenetres: null },
    ];
    const r = ordonnerAvecHoraires(depot, arrets, { debut: 600 });
    expect(r.fermes).toEqual([0]);
    expect(r.impossibles).toEqual([1]);
    expect(r.ordre.slice(-2)).toEqual([1, 0]);
    expect(r.ordre.slice(0, 2).sort()).toEqual([2, 3]);
  });
});

describe("listes enchaînées avec horaires", () => {
  const arret = (id: string, position: number, km: number | null, list_id: string | null = null, status = "pending") => ({
    id,
    position,
    list_id,
    status,
    lat: km === null ? null : est(km).lat,
    lng: km === null ? null : est(km).lng,
  });
  const listes = [
    { id: "L1", name: "Un", position: 0 },
    { id: "L2", name: "Deux", position: 1 },
  ];

  it("sans aucun horaire : même ordre qu'avant", () => {
    const stops = [arret("a", 0, 3, "L1"), arret("b", 1, 1, "L1"), arret("c", 2, 5, "L2"), arret("d", 3, 4, "L2"), arret("n", 4, null, "L1")];
    const sans = sequenceParListes(stops, listes, depot, true);
    const avec = sequenceParListes(stops, listes, depot, true, { debut: 480, fenetres: () => null });
    expect(avec.sequence).toEqual(sans.sequence);
    expect(avec.kmApres).toBeCloseTo(sans.kmApres);
    expect(avec.fin).toBeGreaterThan(480);
    expect(Object.keys(avec.passages).sort()).toEqual(["a", "b", "c", "d"]);
    expect(sans.fin).toBeNull();
  });

  it("l'heure continue d'une liste à l'autre ; fermés en fin de leur liste, avant les non localisés", () => {
    const stops = [
      arret("a", 0, 2, "L1"),
      arret("x", 1, 1, "L1"),
      arret("n", 2, null, "L1"),
      arret("b", 3, 8, "L2"),
      arret("c", 4, 6, "L2"),
      arret("f", 5, 3, "L2", "delivered"),
    ];
    const fen: Record<string, Fenetres> = { x: [], c: [[0, 500]] };
    const r = sequenceParListes(stops, listes, depot, true, { debut: 470, fenetres: (id) => fen[id] ?? null });
    expect(r.sequence[0]).toBe("f");
    expect(r.sequence.slice(1, 4)).toEqual(["a", "x", "n"]);
    expect(r.fermes).toEqual(["x"]);
    // La liste 2 démarre après la liste 1 : « c » (avant 8:20) est servie en tête de sa liste.
    expect(r.sequence.slice(4)).toEqual(["c", "b"]);
    expect(r.passages.c!.arrivee).toBeGreaterThan(r.passages.a!.debut);
    expect(r.passages.c!.statut).toBe("ok");
    expect(r.horsHoraires).toEqual([]);
  });

  it("signale un arrêt servi après la fermeture malgré l'optimisation", () => {
    // Deux arrêts opposés, tous deux « avant 8:15 », départ 8:00 : l'un des deux sera en retard.
    const stops = [arret("o", 0, 4), arret("e", 1, -4)];
    const fen: Record<string, Fenetres> = { o: [[0, 495]], e: [[0, 495]] };
    const r = sequenceParListes(stops, [], depot, true, { debut: 480, fenetres: (id) => fen[id] ?? null });
    expect(r.horsHoraires).toHaveLength(1);
  });
});

describe("fin estimée avec horaires", () => {
  const maintenant = new Date("2026-10-13T06:00:00Z"); // 8:00 à Paris
  const a = (fenetres: [number, number][] | null) => ({ status: "pending" as const, parcel_count: 1, lat: 45.75, lng: 4.85, done_at: null, fenetres });

  it("ajoute l'attente jusqu'à l'ouverture", () => {
    const sans = estimerAvancement([a(null), a(null)], { maintenant });
    const avec = estimerAvancement([a(null), a([[600, 720]])], { maintenant });
    // Arrivée vers 8:03 au 2e arrêt qui ouvre à 10:00 : ~117 min d'attente.
    expect((Date.parse(avec.finEstimee!) - Date.parse(sans.finEstimee!)) / 60000).toBeCloseTo(117, 0);
  });

  it("aucun effet sans horaires, ni si l'on arrive après l'ouverture", () => {
    const sans = estimerAvancement([a(null)], { maintenant });
    expect(estimerAvancement([a([[0, 600]])], { maintenant }).finEstimee).toBe(sans.finEstimee);
    expect(estimerAvancement([a([])], { maintenant }).finEstimee).toBe(sans.finEstimee);
  });
});
