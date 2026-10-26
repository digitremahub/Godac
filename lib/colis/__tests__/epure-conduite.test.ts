import { describe, expect, it } from "vitest";
import { SEUIL_ARRET_KMH, SEUIL_MOUVEMENT_KMH, elementsConduite, enMouvementApres, type EntreeEpure } from "@/lib/colis/epure-conduite";

const base: EntreeEpure = { mouvement: false, vue: "conduite", position: { lat: 45, lng: 4 }, fige: false, enCours: true, traceActive: true };

describe("mouvement du véhicule", () => {
  it("se met en mouvement au-dessus de 5 km/h", () => {
    expect(SEUIL_MOUVEMENT_KMH).toBe(5);
    expect(enMouvementApres(false, 5)).toBe(false);
    expect(enMouvementApres(false, 6)).toBe(true);
  });
  it("hystérésis : reste en mouvement tant que la vitesse ne tombe pas sous le seuil d'arrêt", () => {
    expect(enMouvementApres(true, 4)).toBe(true);
    expect(enMouvementApres(true, SEUIL_ARRET_KMH)).toBe(true);
    expect(enMouvementApres(true, 2)).toBe(false);
    expect(enMouvementApres(true, 0)).toBe(false);
  });
  it("sans vitesse connue, garde l'état précédent", () => {
    expect(enMouvementApres(true, null)).toBe(true);
    expect(enMouvementApres(false, undefined)).toBe(false);
    expect(enMouvementApres(true, Number.NaN)).toBe(true);
  });
});

describe("éléments de l'écran de conduite", () => {
  it("à l'arrêt : retour, Options, ligne d'état et ⋯ de l'arrêt sont affichés", () => {
    const e = elementsConduite(base);
    expect(e).toMatchObject({ retour: true, menuOptions: true, ligneEtat: true, actionsArret: true, replierFeuille: false });
  });
  it("en mouvement : seul ce qui sert à conduire reste (ni Options, ni retour, ni boussole, ni ⋯, feuille repliée)", () => {
    const e = elementsConduite({ ...base, mouvement: true, vue: "libre" });
    expect(e).toMatchObject({ retour: false, menuOptions: false, boussole: false, ligneEtat: false, actionsArret: false, replierFeuille: true });
    // « Recentrer » reste disponible quand la carte a été déplacée.
    expect(e.recentrer).toBe(true);
  });
  it("l'indicateur de trajet enregistré reste affiché en roulant (transparence)", () => {
    expect(elementsConduite({ ...base, mouvement: true }).indicateurTrace).toBe(true);
    expect(elementsConduite({ ...base, traceActive: false }).indicateurTrace).toBe(false);
  });
  it("un seul bouton pour reprendre le suivi : absent en conduite, présent en vue d'ensemble ou carte déplacée avec GPS", () => {
    expect(elementsConduite(base).recentrer).toBe(false);
    expect(elementsConduite({ ...base, vue: "ensemble" }).recentrer).toBe(true);
    expect(elementsConduite({ ...base, vue: "libre" }).recentrer).toBe(true);
    expect(elementsConduite({ ...base, vue: "libre", position: null }).recentrer).toBe(false);
  });
  it("la boussole n'est proposée qu'à l'arrêt et hors vue d'ensemble", () => {
    expect(elementsConduite(base).boussole).toBe(true);
    expect(elementsConduite({ ...base, vue: "ensemble" }).boussole).toBe(false);
  });
  it("tournée clôturée : pas de ligne d'état", () => {
    expect(elementsConduite({ ...base, fige: true }).ligneEtat).toBe(false);
  });
});
