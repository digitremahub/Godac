import { describe, expect, it } from "vitest";
import { formatHeures, heureParis, lignesPresence } from "@/lib/planning/presence-bureau";

const base = { organizationId: "org", serviceId: "svc", userId: "u1", weekStart: "2026-10-12" };

describe("présences des pôles bureau", () => {
  it("une ligne par jour coché, heure de Paris → UTC, sans véhicule", () => {
    const r = lignesPresence({ ...base, jours: [4, 0, 0], debut: "08:30", fin: "17:00" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lignes).toHaveLength(2);
    // Lundi 12 octobre 2026 : heure d'été, UTC+2.
    expect(r.lignes[0]).toMatchObject({
      start_at: "2026-10-12T06:30:00.000Z",
      end_at: "2026-10-12T15:00:00.000Z",
      kind: "presence",
      status: "presence",
      vehicle_id: null,
      tour_number: "PRESENCE-u1",
      driver_id: "u1",
      service_id: "svc",
    });
    expect(r.lignes[1]!.start_at).toBe("2026-10-16T06:30:00.000Z");
    expect(heureParis(r.lignes[0]!.start_at)).toBe("08:30");
  });

  it("refuse des horaires incohérents ou aucun jour", () => {
    expect(lignesPresence({ ...base, jours: [0], debut: "17:00", fin: "08:00" }).ok).toBe(false);
    expect(lignesPresence({ ...base, jours: [0], debut: "8h", fin: "17:00" }).ok).toBe(false);
    expect(lignesPresence({ ...base, jours: [7], debut: "08:00", fin: "17:00" }).ok).toBe(false);
    expect(lignesPresence({ ...base, jours: [], debut: "08:00", fin: "17:00" }).ok).toBe(false);
  });

  it("format des heures", () => {
    expect(formatHeures(7.5)).toBe("7,5 h");
    expect(formatHeures(35)).toBe("35 h");
  });
});
