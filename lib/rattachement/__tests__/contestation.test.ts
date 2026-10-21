import { describe, expect, it } from "vitest";
import { adressesConcordent, evaluerPreuve, rapprocherContestation, type ArretCandidat } from "@/lib/rattachement/contestation";

const arret = (o: Partial<ArretCandidat> & { id: string; driver?: string; date?: string }): ArretCandidat => ({
  parcelCode: null,
  address: "12 rue de la Paix, 75002 Paris",
  recipient: "Marie Martin",
  status: "delivered",
  doneAt: "2026-10-12T09:30:00Z",
  deliveredPlace: "boite_aux_lettres",
  proofPhotoPaths: ["org/p1.jpg"],
  proofCode: null,
  relayName: null,
  lat: 48.8686,
  lng: 2.3314,
  run: { id: `run-${o.driver ?? "a"}`, driverId: o.driver ?? "a", driverName: `Chauffeur ${o.driver ?? "a"}`, runDate: o.date ?? "2026-10-12", planningEntryId: "pe-1", tourNumber: null },
  ...o,
});
const vide = { parcelCode: null, deliveryAddress: null, recipient: null, deliveryDate: null, tourNumber: null };

describe("rapprochement contestation ↔ arrêt", () => {
  it("n° de colis identique (espaces et tirets ignorés) : exact", () => {
    const r = rapprocherContestation({ ...vide, parcelCode: "6A 1234-5678" }, [arret({ id: "s1", parcelCode: "6A12345678" }), arret({ id: "s2", parcelCode: "XX", driver: "b" })]);
    expect(r.confiance).toBe("exact");
    expect(r.arret?.id).toBe("s1");
  });

  it("n° de colis identique mais date contradictoire : probable", () => {
    const r = rapprocherContestation({ ...vide, parcelCode: "6A12345678", deliveryDate: "2026-10-13" }, [arret({ id: "s1", parcelCode: "6A12345678" })]);
    expect(r.confiance).toBe("probable");
  });

  it("adresse livrée le jour dit : probable", () => {
    const r = rapprocherContestation({ ...vide, deliveryAddress: "12 Rue de la Paix Paris", deliveryDate: "2026-10-12" }, [arret({ id: "s1" })]);
    expect(r.confiance).toBe("probable");
    expect(r.arret?.run.driverId).toBe("a");
  });

  it("adresse concordante mais autre jour : aucun", () => {
    const r = rapprocherContestation({ ...vide, deliveryAddress: "12 rue de la Paix", deliveryDate: "2026-10-14" }, [arret({ id: "s1" })]);
    expect(r.confiance).toBe("aucun");
  });

  it("deux chauffeurs au même niveau : pas de suggestion", () => {
    const r = rapprocherContestation({ ...vide, recipient: "Marie Martin", deliveryDate: "2026-10-12" }, [arret({ id: "s1" }), arret({ id: "s2", driver: "b" })]);
    expect(r.arret).toBeNull();
    expect(r.candidats).toHaveLength(2);
  });

  it("concordance d'adresses par les mots significatifs", () => {
    expect(adressesConcordent("12 avenue Victor Hugo 69003 Lyon", "12 av. Victor-Hugo, Lyon 69003")).toBe(true);
    expect(adressesConcordent("3 rue des Lilas", "18 boulevard Haussmann")).toBe(false);
  });
});

describe("preuve de livraison", () => {
  it("photo + boîte aux lettres + position GPS à la clôture : défendable", () => {
    const p = evaluerPreuve(arret({ id: "s1" }), [{ type: "delivered", at: "2026-10-12T09:30:00Z", details: null }], [{ at: "2026-10-12T09:31:00Z", lat: 48.8687, lng: 2.3315 }]);
    expect(p.complete).toBe(true);
    expect(p.verdict).toBe("Preuve de livraison disponible : contestation défendable.");
    expect(p.gps?.distanceM).toBeLessThan(30);
    expect(p.historique[0]?.libelle).toBe("Livré");
  });

  it("lieu « autre » ou sans photo : incomplète", () => {
    expect(evaluerPreuve(arret({ id: "s1", deliveredPlace: "autre" }), []).complete).toBe(false);
    const sans = evaluerPreuve(arret({ id: "s2", proofPhotoPaths: [] }), []);
    expect(sans.complete).toBe(false);
    expect(sans.verdict).toContain("ni photo ni code");
  });

  it("QR code scanné sans photo : défendable ; point relais sans nom : non", () => {
    expect(evaluerPreuve(arret({ id: "s1", deliveredPlace: "qr_code", proofPhotoPaths: [], proofCode: "ABC" }), []).complete).toBe(true);
    expect(evaluerPreuve(arret({ id: "s2", deliveredPlace: "point_relais" }), []).complete).toBe(false);
  });

  it("arrêt en échec : incomplète", () => {
    expect(evaluerPreuve(arret({ id: "s1", status: "failed" }), []).verdict).toContain("arrêt en échec");
  });
});
