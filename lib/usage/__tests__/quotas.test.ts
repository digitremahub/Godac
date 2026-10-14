import { describe, expect, it } from "vitest";
import {
  bornesMoisParis,
  debutJourParis,
  deciderConsommation,
  derniersMois,
  descriptionLigneFacture,
  lignesConsommation,
  libellePeriode,
  lignesDepassement,
  messageRefus,
  montantCentimes,
  plafondJournalierParDefaut,
  resoudreFormule,
  seuilsFranchis,
  unitesEnDepassement,
} from "@/lib/usage/quotas";

const base = { inclusParMois: 300, plafondJour: 100, utiliseMois: 0, utiliseJour: 0, depassementAutorise: true };

describe("deciderConsommation", () => {
  it("compte dans le forfait tant qu'il reste du volume inclus", () => {
    expect(deciderConsommation({ ...base, utiliseMois: 10 }, 1)).toEqual({ ok: true, unitesIncluses: 1, unitesDepassement: 0 });
  });

  it("répartit entre forfait et dépassement à la frontière", () => {
    expect(deciderConsommation({ ...base, utiliseMois: 299 }, 3)).toEqual({ ok: true, unitesIncluses: 1, unitesDepassement: 2 });
  });

  it("facture au-delà du forfait quand le dépassement est autorisé", () => {
    expect(deciderConsommation({ ...base, utiliseMois: 300 }, 1)).toEqual({ ok: true, unitesIncluses: 0, unitesDepassement: 1 });
  });

  it("bloque au-delà du forfait quand le dépassement est refusé", () => {
    expect(deciderConsommation({ ...base, utiliseMois: 300, depassementAutorise: false }, 1)).toEqual({ ok: false, motif: "quota_mensuel" });
    // la dernière unité incluse passe encore
    expect(deciderConsommation({ ...base, utiliseMois: 299, depassementAutorise: false }, 1).ok).toBe(true);
  });

  it("applique le plafond journalier même avec dépassement autorisé", () => {
    expect(deciderConsommation({ ...base, utiliseJour: 100 }, 1)).toEqual({ ok: false, motif: "plafond_jour" });
    expect(deciderConsommation({ ...base, utiliseJour: 99 }, 1).ok).toBe(true);
  });

  it("formule sans volume inclus : tout est en dépassement", () => {
    expect(deciderConsommation({ ...base, inclusParMois: 0 }, 2)).toEqual({ ok: true, unitesIncluses: 0, unitesDepassement: 2 });
  });
});

describe("seuilsFranchis", () => {
  it("signale 80 % puis 100 % une seule fois", () => {
    expect(seuilsFranchis(300, 238, 239)).toEqual([]);
    expect(seuilsFranchis(300, 239, 240)).toEqual([80]);
    expect(seuilsFranchis(300, 240, 241)).toEqual([]);
    expect(seuilsFranchis(300, 299, 300)).toEqual([100]);
    expect(seuilsFranchis(300, 300, 301)).toEqual([]);
  });
  it("peut franchir les deux d'un coup", () => {
    expect(seuilsFranchis(10, 7, 10)).toEqual([80, 100]);
  });
  it("rien sans volume inclus", () => {
    expect(seuilsFranchis(0, 0, 5)).toEqual([]);
  });
});

describe("montants", () => {
  it("dépassement et centimes", () => {
    expect(unitesEnDepassement(420, 300)).toBe(120);
    expect(unitesEnDepassement(200, 300)).toBe(0);
    expect(montantCentimes(120, 0.05)).toBe(600);
    expect(montantCentimes(3, 0.15)).toBe(45);
    expect(montantCentimes(7, 0.033)).toBe(23);
  });

  it("lignesDepassement ignore ce qui reste dans le forfait ou n'a pas de prix", () => {
    expect(
      lignesDepassement(
        [
          { feature: "ocr_ticket", units: 420 },
          { feature: "assistant", units: 50 },
          { feature: "gratuit", units: 999 },
        ],
        { ocr_ticket: 300, assistant: 200 },
        { ocr_ticket: 0.05, assistant: 0.05, gratuit: 0 },
      ),
    ).toEqual([{ feature: "ocr_ticket", unites: 120, montantCentimes: 600 }]);
  });
});

describe("formule et plafond", () => {
  it("resoudreFormule", () => {
    expect(resoudreFormule("pro", "essentiel")).toBe("pro");
    expect(resoudreFormule("inconnu", "business")).toBe("business");
    expect(resoudreFormule(null, null)).toBe("starter");
  });
  it("plafond journalier ≈ 10× la moyenne", () => {
    expect(plafondJournalierParDefaut(300)).toBe(100);
    expect(plafondJournalierParDefaut(3000)).toBe(1000);
    expect(plafondJournalierParDefaut(5)).toBe(20);
  });
});

describe("bornes heure de Paris", () => {
  it("mois courant et précédent (heure d'été)", () => {
    const instant = new Date("2026-05-01T00:30:00+02:00"); // déjà mai à Paris, encore avril en UTC
    expect(bornesMoisParis(instant)).toEqual({ periode: "2026-05", debut: "2026-04-30T22:00:00.000Z", fin: "2026-05-31T22:00:00.000Z" });
    expect(bornesMoisParis(instant, -1)).toEqual({ periode: "2026-04", debut: "2026-03-31T22:00:00.000Z", fin: "2026-04-30T22:00:00.000Z" });
  });
  it("mois traversant le changement d'heure et le changement d'année", () => {
    expect(bornesMoisParis(new Date("2026-01-15T12:00:00Z"), -1)).toEqual({ periode: "2025-12", debut: "2025-11-30T23:00:00.000Z", fin: "2025-12-31T23:00:00.000Z" });
    expect(bornesMoisParis(new Date("2026-03-15T12:00:00Z"))).toEqual({ periode: "2026-03", debut: "2026-02-28T23:00:00.000Z", fin: "2026-03-31T22:00:00.000Z" });
  });
  it("début du jour", () => {
    expect(debutJourParis(new Date("2026-07-10T23:30:00Z"))).toBe("2026-07-10T22:00:00.000Z");
    expect(debutJourParis(new Date("2026-12-10T08:00:00Z"))).toBe("2026-12-09T23:00:00.000Z");
  });
});

describe("tableau de consommation", () => {
  it("lignesConsommation", () => {
    const [l] = lignesConsommation(
      [{ feature: "ocr_ticket", label: "Tickets", unit_label: "ticket", unit_price_eur: 0.05 }],
      { ocr_ticket: 300 },
      { ocr_ticket: 420 },
    );
    expect(l).toMatchObject({ utilise: 420, inclus: 300, depassement: 120, coutEstime: 6, pourcentage: 140 });
  });
  it("derniersMois", () => {
    expect(derniersMois(new Date("2026-02-10T12:00:00Z"), 3)).toEqual(["2026-02", "2026-01", "2025-12"]);
  });
});

describe("libellés", () => {
  it("période et ligne de facture", () => {
    expect(libellePeriode("2026-04")).toBe("avril 2026");
    expect(descriptionLigneFacture("Lecture automatique des tickets", 120, "2026-04")).toBe(
      "Lecture automatique des tickets — 120 au-delà du forfait (avril 2026)",
    );
  });
  it("messages de refus", () => {
    const quota = messageRefus("quota_mensuel", "ocr_ticket", { inclusParMois: 300, plafondJour: 100, prixUnitaire: 0.05 });
    expect(quota).toMatch(/^Quota mensuel atteint pour la lecture des tickets carburant : 300 inclus/);
    expect(quota).toContain("0,05 €");
    expect(messageRefus("plafond_jour", "assistant", { inclusParMois: 200, plafondJour: 67, prixUnitaire: 0.05 })).toContain("67 par jour");
  });
});
