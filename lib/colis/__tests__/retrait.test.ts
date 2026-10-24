import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELAI_ANNULATION_MS, creerRetraitsDifferes, sansRetraits } from "@/lib/colis/retrait";

describe("retrait d'une adresse avec annulation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("la suppression n'est envoyée qu'après le délai", () => {
    const r = creerRetraitsDifferes();
    const envoyer = vi.fn();
    r.planifier("a", envoyer);
    vi.advanceTimersByTime(DELAI_ANNULATION_MS - 1);
    expect(envoyer).not.toHaveBeenCalled();
    expect(r.enAttente("a")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(envoyer).toHaveBeenCalledOnce();
    expect(r.enAttente("a")).toBe(false);
  });
  it("« Annuler » dans le délai : rien n'est envoyé", () => {
    const r = creerRetraitsDifferes();
    const envoyer = vi.fn();
    r.planifier("a", envoyer);
    vi.advanceTimersByTime(3000);
    expect(r.annuler("a")).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(envoyer).not.toHaveBeenCalled();
  });
  it("annuler après l'envoi ou sans retrait : false", () => {
    const r = creerRetraitsDifferes();
    r.planifier("a", () => undefined);
    vi.advanceTimersByTime(DELAI_ANNULATION_MS);
    expect(r.annuler("a")).toBe(false);
    expect(r.annuler("inconnu")).toBe(false);
  });
  it("fermeture de l'écran : les retraits en attente partent tout de suite, une seule fois", async () => {
    const r = creerRetraitsDifferes();
    const a = vi.fn();
    const b = vi.fn();
    r.planifier("a", a);
    r.planifier("b", b);
    await r.vider();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(DELAI_ANNULATION_MS * 2);
    expect(a).toHaveBeenCalledOnce();
  });
  it("replanifier remplace le retrait précédent", () => {
    const r = creerRetraitsDifferes();
    const premier = vi.fn();
    const second = vi.fn();
    r.planifier("a", premier);
    r.planifier("a", second);
    vi.advanceTimersByTime(DELAI_ANNULATION_MS);
    expect(premier).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
  it("l'arrêt retiré disparaît de l'écran, et revient à sa place d'origine après « Annuler »", () => {
    const stops = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(sansRetraits(stops, new Set(["b"])).map((s) => s.id)).toEqual(["a", "c"]);
    expect(sansRetraits(stops, new Set()).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
