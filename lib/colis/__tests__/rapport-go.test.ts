import { describe, expect, it } from "vitest";
import { donneesGo, tourneeDeLigne, type ArretRapport } from "@/lib/colis/rapport-go";

const a = (status: string, extra: Partial<ArretRapport> = {}): ArretRapport => ({ status, parcel_count: 1, done_at: "2026-10-24T09:30:00Z", ...extra });

describe("donneesGo", () => {
  it("sans arrêt : rien", () => expect(donneesGo({ started_at: null }, [])).toBeNull());
  it("compte arrêts, livrés, colis, ramasses et colis ramenés", () => {
    const d = donneesGo({ started_at: "2026-10-24T06:05:00Z" }, [
      a("delivered", { parcel_count: 2 }),
      a("failed", { parcel_count: 3, done_at: "2026-10-24T11:00:00Z" }),
      a("delivered", { kind: "ramasse", parcel_count: 1, packages_picked_up: 4 }),
    ])!;
    expect(d).toMatchObject({ arrets: 2, livres: 1, colis: 5, ramasses: 1, colisRamasses: 4, ramenes: 3 });
    expect(d.depart).toBe("08:05");
    expect(d.retour).toBe("13:00");
  });
  it("pas d'heure de retour tant qu'il reste des arrêts", () => {
    expect(donneesGo({ started_at: null }, [a("delivered"), a("pending", { done_at: null })])!.retour).toBeNull();
  });
});

describe("tourneeDeLigne", () => {
  const run = (id: string, over = {}) => ({ id, planning_entry_id: null, driver_id: "d1", run_date: "2026-10-24", started_at: null, ...over });
  const ligne = { id: "p1", driver_id: "d1", start_at: "2026-10-24T05:30:00Z" };
  it("tournée liée au planning", () => expect(tourneeDeLigne(ligne, [run("r1"), run("r2", { planning_entry_id: "p1" })])?.id).toBe("r2"));
  it("sinon la seule tournée du chauffeur ce jour-là", () => expect(tourneeDeLigne(ligne, [run("r1")])?.id).toBe("r1"));
  it("ambiguë (deux tournées) : aucune", () => expect(tourneeDeLigne(ligne, [run("r1"), run("r2")])).toBeNull());
});
