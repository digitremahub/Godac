import { describe, expect, it } from "vitest";
import { estimerAvancement } from "@/lib/colis/estimation";

const maintenant = new Date("2026-10-13T10:00:00Z");
const arret = (status: "pending" | "delivered" | "failed", done_at: string | null = null, parcel_count = 1) => ({
  status,
  parcel_count,
  lat: 45.7,
  lng: 4.8,
  done_at,
});

describe("avancement de tournée", () => {
  it("compte les adresses et colis restants", () => {
    const a = estimerAvancement([arret("delivered", "2026-10-13T09:00:00Z"), arret("pending", null, 3), arret("pending", null, 2)], { maintenant });
    expect(a.adressesRestantes).toBe(2);
    expect(a.colisRestants).toBe(5);
    expect(a.adressesFaites).toBe(1);
    expect(a.adressesTotal).toBe(3);
  });

  it("au rythme constaté dès 3 arrêts terminés", () => {
    // 3 livraisons espacées de 10 min → 10 min par arrêt, 4 restants → 40 min.
    const a = estimerAvancement(
      [
        arret("delivered", "2026-10-13T09:30:00Z"),
        arret("delivered", "2026-10-13T09:40:00Z"),
        arret("failed", "2026-10-13T09:50:00Z"),
        ...Array.from({ length: 4 }, () => arret("pending")),
      ],
      { maintenant },
    );
    expect(a.methode).toBe("rythme");
    expect(a.finEstimee).toBe("2026-10-13T10:40:00.000Z");
  });

  it("avant cela : durée d'itinéraire + 3 min par arrêt", () => {
    const a = estimerAvancement([arret("pending"), arret("pending")], { maintenant, minutesItineraire: 30 });
    expect(a.methode).toBe("estimation");
    expect(a.finEstimee).toBe("2026-10-13T10:36:00.000Z");
  });

  it("tournée terminée : pas d'heure de fin", () => {
    expect(estimerAvancement([arret("delivered", "2026-10-13T09:00:00Z")], { maintenant }).finEstimee).toBeNull();
  });
});
