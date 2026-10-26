import { describe, expect, it } from "vitest";
import { estimerAvancement } from "@/lib/colis/estimation";
import { arretsRestants, cloturesHorsOrdre, libelleMotif, motifsPour, prochainArret, refusCloture, refusReouverture, tourneeCloturee } from "@/lib/colis/cloture";

const a = (id: string, status: "pending" | "delivered" | "failed" = "pending") => ({ id, status });

describe("clôture hors ordre", () => {
  it("le prochain reste le premier non clôturé dans l'ordre", () => {
    const stops = [a("1"), a("2"), a("3", "delivered"), a("4")];
    expect(prochainArret(stops)?.id).toBe("1");
    expect(arretsRestants(stops).map((s) => s.id)).toEqual(["1", "2", "4"]);
    expect(cloturesHorsOrdre(stops).map((s) => s.id)).toEqual(["3"]);
  });
  it("arrêts clôturés dans l'ordre puis hors ordre, échec compris", () => {
    const stops = [a("1", "delivered"), a("2"), a("3", "failed"), a("4", "delivered"), a("5")];
    expect(prochainArret(stops)?.id).toBe("2");
    expect(arretsRestants(stops).map((s) => s.id)).toEqual(["2", "5"]);
    expect(cloturesHorsOrdre(stops).map((s) => s.id)).toEqual(["3", "4"]);
  });
  it("tout clôturé : plus de prochain", () => {
    const stops = [a("1", "delivered"), a("2", "failed")];
    expect(prochainArret(stops)).toBeNull();
    expect(arretsRestants(stops)).toEqual([]);
    expect(cloturesHorsOrdre(stops)).toEqual([]);
  });
  it("un arrêt clôturé hors ordre sort des restants de l'estimation", () => {
    const base = { parcel_count: 2, lat: null, lng: null, done_at: null, fenetres: null };
    const av = estimerAvancement(
      [
        { ...base, status: "pending" },
        { ...base, status: "delivered", done_at: new Date().toISOString() },
        { ...base, status: "pending" },
      ],
      { maintenant: new Date() },
    );
    expect(av.adressesRestantes).toBe(2);
    expect(av.colisRestants).toBe(4);
  });
});

describe("contrôle de clôture", () => {
  it("aucune contrainte d'ordre, mais pas de double clôture", () => {
    expect(refusCloture("pending", "delivered")).toBeNull();
    expect(refusCloture("pending", "failed")).toBeNull();
    expect(refusCloture("delivered", "failed")).toMatch(/déjà clôturé/);
    expect(refusCloture("failed", "delivered")).toMatch(/déjà clôturé/);
  });
  it("annulation seulement d'un arrêt clôturé", () => {
    expect(refusCloture("delivered", "pending")).toBeNull();
    expect(refusCloture("failed", "pending")).toBeNull();
    expect(refusCloture("pending", "pending")).not.toBeNull();
  });
});

describe("motifs d'échec", () => {
  it("libellés et motifs selon le type d'arrêt", () => {
    expect(libelleMotif("absent")).toBe("Client absent");
    expect(libelleMotif(null)).toBeNull();
    expect(motifsPour(true).map((m) => m.key)).toContain("rien_a_ramasser");
    expect(motifsPour(true).map((m) => m.key)).not.toContain("refuse");
    expect(motifsPour(false).map((m) => m.key)).not.toContain("rien_a_ramasser");
  });
});

describe("tournée clôturée", () => {
  it("fige les arrêts d'une tournée clôturée, quelle que soit la forme de la jointure", () => {
    expect(tourneeCloturee({ delivery_runs: { status: "done" } })).toBe(true);
    expect(tourneeCloturee({ delivery_runs: [{ status: "done" }] })).toBe(true);
    expect(tourneeCloturee({ delivery_runs: { status: "in_progress" } })).toBe(false);
    expect(tourneeCloturee({ delivery_runs: null })).toBe(false);
  });
});

describe("réouverture d'une tournée clôturée", () => {
  it("refuse au chauffeur tout retour arrière depuis done", () => {
    expect(refusReouverture("done", "loading", false)).toMatch(/encadrement/);
    expect(refusReouverture("done", "in_progress", false)).toMatch(/encadrement/);
  });
  it("l'encadrement peut rouvrir", () => {
    expect(refusReouverture("done", "loading", true)).toBeNull();
  });
  it("les autres changements ne sont pas concernés", () => {
    expect(refusReouverture("done", "done", false)).toBeNull();
    expect(refusReouverture("done", undefined, false)).toBeNull();
    expect(refusReouverture("loading", "in_progress", false)).toBeNull();
    expect(refusReouverture("in_progress", "done", false)).toBeNull();
  });
});
