import { describe, expect, it } from "vitest";
import { enregistrerChoix, etatRemise, libelleEtat, papierDemande } from "@/lib/paie/remise-electronique";

describe("remise électronique et opposition (art. L3243-2)", () => {
  it("électronique par défaut, sans choix enregistré", () => {
    expect(etatRemise(null)).toEqual({ mode: "electronique", depuis: null });
    expect(papierDemande(undefined)).toBe(false);
    expect(libelleEtat(etatRemise(null))).toBe("Remise électronique (par défaut).");
  });

  it("l'opposition est datée par le serveur", () => {
    const maintenant = new Date("2026-10-21T08:30:00Z");
    const r = enregistrerChoix({ actuel: null, papier: true, maintenant });
    expect(r).toEqual({ ok: true, ligne: { paper_requested: true, decided_at: "2026-10-21T08:30:00.000Z" } });
    const etat = etatRemise({ paper_requested: true, decided_at: "2026-10-21T08:30:00.000Z" });
    expect(etat.mode).toBe("papier");
    expect(libelleEtat(etat)).toBe("Bulletin papier demandé le 21/10/2026.");
  });

  it("un choix identique n'est pas réenregistré ; le retour à l'électronique l'est", () => {
    const actuel = { paper_requested: true, decided_at: "2026-10-01T10:00:00.000Z" };
    expect(enregistrerChoix({ actuel, papier: true, maintenant: new Date() }).ok).toBe(false);
    const retour = enregistrerChoix({ actuel, papier: false, maintenant: new Date("2026-11-02T09:00:00Z") });
    expect(retour.ok && retour.ligne.paper_requested).toBe(false);
  });

  it("premier choix explicite de l'électronique accepté (date enregistrée)", () => {
    expect(enregistrerChoix({ actuel: null, papier: false, maintenant: new Date() }).ok).toBe(true);
  });
});
