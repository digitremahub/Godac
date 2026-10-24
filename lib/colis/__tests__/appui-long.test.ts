import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELAI_APPUI_LONG_MS, creerAppuiLong } from "@/lib/colis/appui-long";

describe("appui long (menu rapide d'un arrêt)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("se déclenche après 500 ms et le clic qui suit est ignoré une fois", () => {
    const ouvrir = vi.fn();
    const a = creerAppuiLong(ouvrir);
    a.debut(10, 10);
    vi.advanceTimersByTime(DELAI_APPUI_LONG_MS);
    expect(ouvrir).toHaveBeenCalledOnce();
    a.fin();
    expect(a.clicIgnore()).toBe(true);
    expect(a.clicIgnore()).toBe(false);
  });
  it("un appui court ne déclenche rien et son clic passe", () => {
    const ouvrir = vi.fn();
    const a = creerAppuiLong(ouvrir);
    a.debut(0, 0);
    vi.advanceTimersByTime(200);
    a.fin();
    vi.advanceTimersByTime(1000);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(a.clicIgnore()).toBe(false);
  });
  it("un défilement du doigt l'annule", () => {
    const ouvrir = vi.fn();
    const a = creerAppuiLong(ouvrir);
    a.debut(0, 0);
    a.deplace(3, 2);
    a.deplace(0, 30);
    vi.advanceTimersByTime(1000);
    expect(ouvrir).not.toHaveBeenCalled();
  });
});
