import { describe, expect, it } from "vitest";
import {
  ZOOM_ROUTE,
  ZOOM_VILLE,
  capDuTrace,
  capEntre,
  choisirCap,
  dureeAnimation,
  ecartCap,
  interpoler,
  lisserCap,
  lisserZoom,
  margesConduite,
  vitesseEstimee,
  zoomSelonVitesse,
} from "@/lib/colis/conduite";

describe("cap : lissage et choix", () => {
  it("écart le plus court, en passant par le nord", () => {
    expect(ecartCap(350, 10)).toBe(20);
    expect(ecartCap(10, 350)).toBe(-20);
    expect(ecartCap(0, 180)).toBe(180);
  });
  it("lissage : moitié du chemin, par le plus court", () => {
    expect(lisserCap(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(lisserCap(10, 350, 0.5)).toBeCloseTo(0, 5);
    expect(lisserCap(90, 180, 0.5)).toBe(135);
  });
  it("lissage : pas de cap précédent → la mesure ; tremblement ignoré", () => {
    expect(lisserCap(null, -90)).toBe(270);
    expect(lisserCap(100, 102)).toBe(100);
  });
  it("cap entre deux points", () => {
    expect(capEntre({ lat: 48, lng: 2 }, { lat: 48.01, lng: 2 })).toBeCloseTo(0, 1);
    expect(capEntre({ lat: 48, lng: 2 }, { lat: 48, lng: 2.01 })).toBeCloseTo(90, 0);
    expect(capEntre({ lat: 48, lng: 2 }, { lat: 47.99, lng: 2 })).toBeCloseTo(180, 1);
    expect(capEntre({ lat: 48, lng: 2 }, { lat: 48, lng: 1.99 })).toBeCloseTo(270, 0);
  });
  it("GPS en mouvement : son cap ; lent : cap entre positions ; immobile : direction du tracé", () => {
    const a = { lat: 48, lng: 2 };
    const auNord = { lat: 48.001, lng: 2 };
    const ligne: [number, number][] = [[2, 48], [2.01, 48]]; // vers l'est
    expect(choisirCap({ capGps: 200, vitesse: 10, precedente: a, actuelle: auNord, ligne })).toBe(200);
    expect(choisirCap({ capGps: 200, vitesse: 0.5, precedente: a, actuelle: auNord, ligne })).toBeCloseTo(0, 1);
    expect(choisirCap({ capGps: null, vitesse: 0, precedente: a, actuelle: { lat: 48.00001, lng: 2 }, ligne })).toBeCloseTo(90, 0);
    expect(choisirCap({ capGps: null, vitesse: 0, precedente: null, actuelle: a, ligne: null })).toBeNull();
    expect(capDuTrace(a, [])).toBeNull();
  });
});

describe("zoom selon la vitesse", () => {
  it("à l'arrêt et en ville : 17,5 ; à 90 km/h et plus : 15,5", () => {
    expect(zoomSelonVitesse(0)).toBe(ZOOM_VILLE);
    expect(zoomSelonVitesse(null)).toBe(ZOOM_VILLE);
    expect(zoomSelonVitesse(15 / 3.6)).toBe(ZOOM_VILLE);
    expect(zoomSelonVitesse(90 / 3.6)).toBe(ZOOM_ROUTE);
    expect(zoomSelonVitesse(130 / 3.6)).toBe(ZOOM_ROUTE);
  });
  it("entre les deux : décroît régulièrement", () => {
    const z50 = zoomSelonVitesse(50 / 3.6);
    expect(z50).toBeLessThan(ZOOM_VILLE);
    expect(z50).toBeGreaterThan(ZOOM_ROUTE);
    expect(zoomSelonVitesse(55 / 3.6)).toBeCloseTo((ZOOM_VILLE + ZOOM_ROUTE) / 2, 5);
  });
  it("lissage du zoom", () => {
    expect(lisserZoom(null, 16)).toBe(16);
    expect(lisserZoom(17, 16, 0.5)).toBe(16.5);
  });
  it("vitesse déduite des positions quand le GPS ne la donne pas", () => {
    expect(vitesseEstimee(12, null, { lat: 48, lng: 2, t: 0 })).toBe(12);
    const v = vitesseEstimee(null, { lat: 48, lng: 2, t: 0 }, { lat: 48.0009, lng: 2, t: 10_000 });
    expect(v).toBeGreaterThan(9.5);
    expect(v).toBeLessThan(10.5);
  });
});

describe("animation et caméra", () => {
  it("interpolation linéaire, cap par le plus court chemin", () => {
    const e = interpoler({ lng: 2, lat: 48, cap: 350, zoom: 17 }, { lng: 2.002, lat: 48.002, cap: 10, zoom: 16 }, 0.5);
    expect(e.lng).toBeCloseTo(2.001, 6);
    expect(e.lat).toBeCloseTo(48.001, 6);
    expect(e.cap).toBeCloseTo(0, 5);
    expect(e.zoom).toBe(16.5);
  });
  it("durée = intervalle GPS borné ; mouvements réduits : court", () => {
    expect(dureeAnimation(1000)).toBe(1000);
    expect(dureeAnimation(50)).toBe(300);
    expect(dureeAnimation(10_000)).toBe(2000);
    expect(dureeAnimation(null)).toBe(1000);
    expect(dureeAnimation(1000, true)).toBe(150);
  });
  it("marges : la voiture dans le bas de la zone visible, au-dessus de la feuille", () => {
    const m = margesConduite(800, 300, 160);
    expect(m.bottom).toBe(310);
    const centre = (m.top + (800 - m.bottom)) / 2;
    const zone = 800 - 310 - 160;
    expect(centre).toBeCloseTo(160 + zone * 0.75, 0);
    // Feuille très haute : marges bornées.
    const g = margesConduite(800, 2000, 160);
    expect(g.top).toBeLessThan(800 - g.bottom);
  });
});
