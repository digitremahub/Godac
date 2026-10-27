import { describe, expect, it } from "vitest";
import {
  PALIERS_ECHEANCE,
  cleEcheance,
  documentsEnVigueur,
  echeancesANotifier,
  echeancesSouhaitees,
  joursRestants,
  palierAtteint,
  rolesDestinataires,
  type AmendeAEcheance,
  type DocumentVehicule,
} from "../echeances";
import { alertesEcheanceAClore } from "../cloture";

const AUJOURDHUI = "2026-10-27";
const doc = (o: Partial<DocumentVehicule> = {}): DocumentVehicule => ({
  id: "d1",
  vehicle_id: "v1",
  doc_type: "Contrôle technique",
  expires_on: "2026-11-26",
  uploaded_at: "2025-11-20T10:00:00Z",
  registration: "AB-123-CD",
  service_id: "s1",
  ...o,
});
const amende = (o: Partial<AmendeAEcheance> = {}): AmendeAEcheance => ({ id: "a1", registration: "AB-123-CD", service_id: "s1", status: "identified", payment_deadline: "2026-11-03", amount: 135, reduced_amount: 90, reference: "AVIS-42", ...o });

describe("paliers", () => {
  it("J-30, J-7 et J0", () => {
    expect([...PALIERS_ECHEANCE]).toEqual([30, 7, 0]);
  });
  it("palier atteint selon les jours restants", () => {
    expect(palierAtteint(31)).toBeNull();
    expect(palierAtteint(30)).toBe(30);
    expect(palierAtteint(8)).toBe(30);
    expect(palierAtteint(7)).toBe(7);
    expect(palierAtteint(1)).toBe(7);
    expect(palierAtteint(0)).toBe(0);
    expect(palierAtteint(-12)).toBe(0);
    expect(palierAtteint(Number.NaN)).toBeNull();
  });
  it("jours restants en jours entiers de Paris", () => {
    expect(joursRestants("2026-11-26", AUJOURDHUI)).toBe(30);
    expect(joursRestants("2026-10-27", AUJOURDHUI)).toBe(0);
    expect(joursRestants("2026-10-20T00:00:00Z", AUJOURDHUI)).toBe(-7);
  });
});

describe("échéances souhaitées", () => {
  it("document à 30 jours : palier J-30, information, destinataires du service", () => {
    const [e] = echeancesSouhaitees([doc()], [], AUJOURDHUI);
    expect(e).toMatchObject({ genre: "document", relatedTable: "vehicles", relatedId: "v1", palier: 30, severity: "info", jours: 30, serviceId: "s1", cle: "document:d1:2026-11-26:J-30" });
    expect(e!.recipientRoles).toEqual(["manager", "exploitation", "direction"]);
    expect(e!.message).toContain("Contrôle technique");
    expect(e!.message).toContain("AB-123-CD");
    expect(e!.message).toContain("26/11/2026");
  });
  it("à 7 jours : J-7 (avertissement) ; échéance atteinte ou dépassée : J0 (critique)", () => {
    expect(echeancesSouhaitees([doc({ expires_on: "2026-11-03" })], [], AUJOURDHUI)[0]).toMatchObject({ palier: 7, severity: "warning" });
    expect(echeancesSouhaitees([doc({ expires_on: "2026-10-27" })], [], AUJOURDHUI)[0]).toMatchObject({ palier: 0, severity: "critical" });
    const depasse = echeancesSouhaitees([doc({ expires_on: "2026-10-20" })], [], AUJOURDHUI)[0]!;
    expect(depasse).toMatchObject({ palier: 0, severity: "critical", jours: -7 });
    expect(depasse.message).toContain("dépassée depuis 7 jours");
  });
  it("à plus de 30 jours ou sans date : rien", () => {
    expect(echeancesSouhaitees([doc({ expires_on: "2026-11-27" }), doc({ id: "d2", expires_on: null, doc_type: "Attestation d'assurance" })], [], AUJOURDHUI)).toEqual([]);
  });
  it("véhicule sans service : exploitation et direction seulement (jamais un manager)", () => {
    expect(rolesDestinataires(null)).toEqual(["exploitation", "direction"]);
    expect(echeancesSouhaitees([doc({ service_id: null })], [], AUJOURDHUI)[0]!.recipientRoles).toEqual(["exploitation", "direction"]);
  });
  it("amende ouverte avec date limite de paiement minoré", () => {
    const [e] = echeancesSouhaitees([], [amende()], AUJOURDHUI);
    expect(e).toMatchObject({ genre: "amende", relatedTable: "fines", relatedId: "a1", palier: 7, cle: "amende:a1:2026-11-03:J-7" });
    expect(e!.message).toContain("AVIS-42");
    expect(e!.message).toContain("90,00");
    expect(e!.message).toContain("03/11/2026");
  });
  it("amende réglée, classée ou sans date limite : plus d'échéance", () => {
    expect(echeancesSouhaitees([], [amende({ status: "paid" }), amende({ id: "a2", status: "dismissed" }), amende({ id: "a3", payment_deadline: null })], AUJOURDHUI)).toEqual([]);
  });
  it("triées de la plus urgente à la moins urgente", () => {
    const e = echeancesSouhaitees([doc({ expires_on: "2026-11-20" }), doc({ id: "d2", doc_type: "Attestation d'assurance", expires_on: "2026-10-25" })], [amende()], AUJOURDHUI);
    expect(e.map((x) => x.jours)).toEqual([-2, 7, 24]);
  });
});

describe("document renouvelé", () => {
  it("le dernier document déposé de chaque véhicule et type fait foi", () => {
    const ancien = doc({ id: "ancien", expires_on: "2026-10-30", uploaded_at: "2025-10-30T10:00:00Z" });
    const renouvele = doc({ id: "nouveau", expires_on: "2027-10-30", uploaded_at: "2026-10-26T10:00:00Z" });
    expect(documentsEnVigueur([ancien, renouvele]).map((d) => d.id)).toEqual(["nouveau"]);
    // L'ancien document n'a plus d'échéance à surveiller : son alerte se clôt.
    expect(echeancesSouhaitees([ancien, renouvele], [], AUJOURDHUI)).toEqual([]);
  });
  it("renouvelé sans date saisie : plus d'alerte sur l'ancien", () => {
    expect(echeancesSouhaitees([doc({ id: "ancien", expires_on: "2026-10-30" }), doc({ id: "nouveau", expires_on: null, uploaded_at: "2026-10-26T10:00:00Z" })], [], AUJOURDHUI)).toEqual([]);
  });
  it("un autre véhicule ou un autre type ne se remplacent pas ; « Autre » garde tous ses documents", () => {
    const liste = [doc(), doc({ id: "d2", vehicle_id: "v2" }), doc({ id: "d3", doc_type: "Attestation d'assurance" }), doc({ id: "d4", doc_type: "Autre" }), doc({ id: "d5", doc_type: "Autre" })];
    expect(documentsEnVigueur(liste).map((d) => d.id).sort()).toEqual(["d1", "d2", "d3", "d4", "d5"]);
  });
});

describe("dédoublonnage par échéance et par palier", () => {
  const [j30] = echeancesSouhaitees([doc()], [], AUJOURDHUI);
  it("une alerte déjà créée pour cette échéance et ce palier n'est pas recréée", () => {
    expect(echeancesANotifier([j30!], [{ cle_dedoublonnage: j30!.cle }])).toEqual([]);
    expect(echeancesANotifier([j30!], [])).toEqual([j30]);
    expect(echeancesANotifier([j30!], [{ cle_dedoublonnage: null }])).toEqual([j30]);
  });
  it("un palier plus urgent crée une nouvelle alerte", () => {
    const [j7] = echeancesSouhaitees([doc({ expires_on: "2026-11-03" })], [], AUJOURDHUI);
    expect(echeancesANotifier([j7!], [{ cle_dedoublonnage: cleEcheance("document", "d1", "2026-11-03", 30) }])).toEqual([j7]);
  });
  it("une échéance modifiée (nouvelle date) repart de zéro", () => {
    expect(cleEcheance("document", "d1", "2026-11-26", 30)).not.toBe(cleEcheance("document", "d1", "2026-12-26", 30));
  });
});

describe("clôture automatique", () => {
  it("clôt les alertes dont l'échéance et le palier ne sont plus actifs, jamais celles sans clé", () => {
    const actives = new Set(["document:d1:2026-11-03:J-7"]);
    const ouvertes = [
      { id: "a", cle_dedoublonnage: "document:d1:2026-11-03:J-7" },
      { id: "b", cle_dedoublonnage: "document:d1:2026-11-03:J-30" }, // remplacée par un palier plus urgent
      { id: "c", cle_dedoublonnage: "amende:a1:2026-11-03:J-7" }, // amende réglée
      { id: "d", cle_dedoublonnage: null },
    ];
    expect(alertesEcheanceAClore(ouvertes, actives)).toEqual(["b", "c"]);
  });
  it("document renouvelé : toutes les alertes de l'ancienne échéance se closent", () => {
    expect(alertesEcheanceAClore([{ id: "a", cle_dedoublonnage: "document:d1:2026-10-30:J-7" }], new Set())).toEqual(["a"]);
  });
});
