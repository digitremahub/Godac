import { describe, expect, it } from "vitest";
import {
  distanceParlee,
  formatDistanceManoeuvre,
  manoeuvreCourante,
  manoeuvresOsrm,
  palierAnnonce,
  phraseAnnonce,
  pictogramme,
  placerManoeuvres,
  texteManoeuvre,
  type Manoeuvre,
} from "@/lib/colis/manoeuvres";

const m = (type: string, modifier?: string, rue = "", sortie?: number): Manoeuvre => ({ type, ...(modifier ? { modifier } : {}), rue, ...(sortie ? { sortie } : {}), distanceM: 0, lieu: [0, 0] });

describe("texte des manœuvres", () => {
  it("tourner, continuer, demi-tour, arrivée", () => {
    expect(texteManoeuvre(m("turn", "right", "rue X"))).toBe("Tournez à droite sur rue X");
    expect(texteManoeuvre(m("turn", "left"))).toBe("Tournez à gauche");
    expect(texteManoeuvre(m("turn", "slight right", "avenue Foch"))).toBe("Tournez légèrement à droite sur avenue Foch");
    expect(texteManoeuvre(m("end of road", "sharp left"))).toBe("Tournez franchement à gauche");
    expect(texteManoeuvre(m("continue", "straight"))).toBe("Continuez tout droit");
    expect(texteManoeuvre(m("new name", "straight", "rue Y"))).toBe("Continuez sur rue Y");
    expect(texteManoeuvre(m("continue", "uturn"))).toBe("Faites demi-tour");
    expect(texteManoeuvre(m("arrive"))).toBe("Vous êtes arrivé");
  });
  it("ronds-points", () => {
    expect(texteManoeuvre(m("roundabout", "right", "", 2))).toBe("Au rond-point, prenez la 2e sortie");
    expect(texteManoeuvre(m("rotary", undefined, "D 906", 1))).toBe("Au rond-point, prenez la 1re sortie sur D 906");
    expect(texteManoeuvre(m("roundabout"))).toBe("Prenez le rond-point");
    expect(texteManoeuvre(m("exit roundabout", "right", "rue Z"))).toBe("Sortez du rond-point sur rue Z");
  });
  it("embranchements et bretelles", () => {
    expect(texteManoeuvre(m("fork", "slight left"))).toBe("À l'embranchement, restez à gauche");
    expect(texteManoeuvre(m("off ramp", "slight right"))).toBe("Prenez la sortie à droite");
  });
  it("pictogrammes", () => {
    expect(pictogramme(m("turn", "left"))).toBe("gauche");
    expect(pictogramme(m("turn", "slight right"))).toBe("legere-droite");
    expect(pictogramme(m("roundabout", "right", "", 3))).toBe("rond-point");
    expect(pictogramme(m("continue", "uturn"))).toBe("demi-tour");
    expect(pictogramme(m("new name"))).toBe("tout-droit");
    expect(pictogramme(m("arrive"))).toBe("arrivee");
  });
});

describe("réponse OSRM", () => {
  it("liste compacte : rue (sinon numéro), sortie, point ; arrivées intermédiaires retirées", () => {
    const etape = (type: string, extra: Record<string, unknown> = {}, rue: { name?: string; ref?: string } = {}) => ({
      distance: 120.4,
      ...rue,
      maneuver: { type, location: [2, 48] as [number, number], ...extra },
    });
    const res = manoeuvresOsrm([
      { steps: [etape("depart", {}, { name: "rue A" }), etape("turn", { modifier: "left" }, { name: "", ref: "D 12" }), etape("arrive")] },
      { steps: [etape("depart"), etape("roundabout", { modifier: "right", exit: 2 }, { name: "rue B" }), etape("arrive")] },
    ]);
    expect(res.map((x) => x.type)).toEqual(["depart", "turn", "roundabout", "arrive"]);
    expect(res[1]).toEqual({ type: "turn", modifier: "left", rue: "D 12", distanceM: 120, lieu: [2, 48] });
    expect(res[2]!.sortie).toBe(2);
    expect(manoeuvresOsrm(undefined)).toEqual([]);
    expect(manoeuvresOsrm([{}])).toEqual([]);
  });
});

describe("manœuvre courante selon la distance parcourue", () => {
  // Tracé rectiligne vers l'est, ~ 74 m par 0,001° de longitude à 48°.
  const ligne: [number, number][] = [[2, 48], [2.002, 48], [2.004, 48], [2.006, 48]];
  const mm = (type: string, lng: number): Manoeuvre => ({ type, rue: "", distanceM: 0, lieu: [lng, 48] });
  const placees = placerManoeuvres(ligne, [mm("depart", 2), mm("turn", 2.002), mm("turn", 2.004), mm("arrive", 2.006)]);
  it("placement le long du tracé, dans l'ordre", () => {
    expect(placees[0]!.abscisseM).toBe(0);
    expect(placees[1]!.abscisseM).toBeGreaterThan(140);
    expect(placees[1]!.abscisseM).toBeLessThan(160);
    expect(placees[3]!.abscisseM).toBeGreaterThan(placees[2]!.abscisseM);
  });
  it("au départ : la première manœuvre après le départ", () => {
    const c = manoeuvreCourante(placees, 0)!;
    expect(c.index).toBe(1);
    expect(c.distanceM).toBeCloseTo(placees[1]!.abscisseM, 5);
  });
  it("point juste atteint : on la garde ; dépassé : la suivante", () => {
    expect(manoeuvreCourante(placees, placees[1]!.abscisseM + 5)!.index).toBe(1);
    expect(manoeuvreCourante(placees, placees[1]!.abscisseM + 5)!.distanceM).toBe(0);
    expect(manoeuvreCourante(placees, placees[1]!.abscisseM + 20)!.index).toBe(2);
  });
  it("tout dépassé : l'arrivée, distance nulle ; sans manœuvre : null", () => {
    expect(manoeuvreCourante(placees, 10_000)).toEqual({ index: 3, distanceM: 0 });
    expect(manoeuvreCourante([], 0)).toBeNull();
    expect(placerManoeuvres([], [mm("turn", 2)])).toEqual([]);
  });
});

describe("format des distances et annonces", () => {
  it("distances affichées", () => {
    expect(formatDistanceManoeuvre(4)).toBe("10 m");
    expect(formatDistanceManoeuvre(84)).toBe("80 m");
    expect(formatDistanceManoeuvre(312)).toBe("300 m");
    expect(formatDistanceManoeuvre(980)).toBe("1 km");
    expect(formatDistanceManoeuvre(1234)).toBe("1,2 km");
    expect(formatDistanceManoeuvre(12_400)).toBe("12 km");
    expect(formatDistanceManoeuvre(null)).toBe("—");
    expect(formatDistanceManoeuvre(-1)).toBe("—");
  });
  it("distances parlées", () => {
    expect(distanceParlee(300)).toBe("300 mètres");
    expect(distanceParlee(1500)).toBe("1,5 kilomètre");
    expect(distanceParlee(2500)).toBe("2,5 kilomètres");
  });
  it("paliers : ~500 m, ~150 m, au point", () => {
    expect(palierAnnonce(800)).toBeNull();
    expect(palierAnnonce(480)).toBe("500");
    expect(palierAnnonce(140)).toBe("150");
    expect(palierAnnonce(20)).toBe("point");
  });
  it("phrases", () => {
    expect(phraseAnnonce(m("turn", "right", "rue X"), "500", 480)).toBe("Dans 500 mètres, tournez à droite sur rue X");
    expect(phraseAnnonce(m("roundabout", "right", "", 2), "point", 10)).toBe("Au rond-point, prenez la 2e sortie");
    expect(phraseAnnonce(m("arrive"), "150", 140)).toBe("Dans 150 mètres, vous arrivez à destination");
    expect(phraseAnnonce(m("arrive"), "point", 5)).toBe("Vous êtes arrivé");
  });
});
