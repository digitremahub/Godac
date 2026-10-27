import { describe, expect, it } from "vitest";
import { alertesEcheanceAClore } from "@/lib/alerts/cloture";
import { destinatairesRh, echeancesRhANotifier, echeancesRhSouhaitees, palierAtteintRh, type DocumentSalarie } from "@/lib/alerts/echeances-rh";
import { alerteVisiblePour } from "@/lib/alerts/destinataires";

const doc = (p: Partial<DocumentSalarie>): DocumentSalarie => ({ id: "d1", user_id: "u1", nom: "Marie Durand", doc_type: "Permis de conduire", expires_at: "2026-11-20", uploaded_at: "2026-01-01", service_id: "s1", ...p });

describe("paliers RH", () => {
  it("J-60, J-30, J-7, J0", () => {
    expect(palierAtteintRh(61)).toBeNull();
    expect(palierAtteintRh(60)).toBe(60);
    expect(palierAtteintRh(31)).toBe(60);
    expect(palierAtteintRh(30)).toBe(30);
    expect(palierAtteintRh(8)).toBe(30);
    expect(palierAtteintRh(7)).toBe(7);
    expect(palierAtteintRh(1)).toBe(7);
    expect(palierAtteintRh(0)).toBe(0);
    expect(palierAtteintRh(-5)).toBe(0);
  });
});

describe("échéances souhaitées", () => {
  it("permis à 24 jours : palier J-30, manager du service destinataire", () => {
    const [e] = echeancesRhSouhaitees([doc({})], [], "2026-10-27");
    expect(e).toMatchObject({ genre: "permis", palier: 30, serviceId: "s1" });
    expect(e!.recipientRoles).toEqual(["manager", "exploitation", "direction"]);
  });
  it("visite médicale : aucune donnée médicale, ni manager ni service", () => {
    const [e] = echeancesRhSouhaitees([doc({ doc_type: "Visite médicale (aptitude)" })], [], "2026-10-27");
    expect(e!.message).toContain("Visite médicale à renouveler");
    expect(e!.recipientRoles).toEqual(["exploitation", "direction"]);
    expect(e!.serviceId).toBeNull();
  });
  it("titre de séjour : direction seule", () => {
    expect(destinatairesRh("titre_sejour", "s1")).toEqual({ roles: ["direction"], serviceId: null });
  });
  it("fin de contrat, sauf dossier clos", () => {
    const c = { user_id: "u2", nom: "Paul", contract_end_date: "2026-10-30", hr_status: "active", service_id: null };
    expect(echeancesRhSouhaitees([], [c], "2026-10-27")[0]).toMatchObject({ genre: "contrat", palier: 7 });
    expect(echeancesRhSouhaitees([], [{ ...c, hr_status: "terminated" }], "2026-10-27")).toEqual([]);
  });
  it("dédoublonnage par palier", () => {
    const [e] = echeancesRhSouhaitees([doc({})], [], "2026-10-27");
    expect(echeancesRhANotifier([e!], [{ cle_dedoublonnage: e!.cle }])).toEqual([]);
    const [plus] = echeancesRhSouhaitees([doc({})], [], "2026-11-15");
    expect(echeancesRhANotifier([plus!], [{ cle_dedoublonnage: e!.cle }])).toHaveLength(1);
  });
  it("document renouvelé (nouveau dépôt, nouvelle date) : l'ancienne clé se clôt", () => {
    const [ancienne] = echeancesRhSouhaitees([doc({})], [], "2026-10-27");
    const apres = echeancesRhSouhaitees([doc({}), doc({ id: "d2", uploaded_at: "2026-10-28", expires_at: "2029-01-01" })], [], "2026-10-28");
    expect(apres).toEqual([]);
    expect(alertesEcheanceAClore([{ id: "a1", cle_dedoublonnage: ancienne!.cle }], new Set(apres.map((x) => x.cle)))).toEqual(["a1"]);
  });
  it("hors de la fenêtre de 60 jours : rien", () => {
    expect(echeancesRhSouhaitees([doc({ expires_at: "2027-06-01" })], [], "2026-10-27")).toEqual([]);
  });
});

describe("visibilité des alertes RH", () => {
  it("manager : son service seulement ; comptable et chauffeur jamais", () => {
    expect(alerteVisiblePour("manager", "echeance_rh", "s1", ["s1"])).toBe(true);
    expect(alerteVisiblePour("manager", "echeance_rh", null, ["s1"])).toBe(false);
    expect(alerteVisiblePour("comptable", "echeance_rh", "s1", ["s1"])).toBe(false);
    expect(alerteVisiblePour("chauffeur", "pointage_a_regulariser", "s1", ["s1"])).toBe(false);
  });
  it("paiement échoué : direction seule", () => {
    expect(alerteVisiblePour("direction", "paiement_echoue", null)).toBe(true);
    for (const r of ["exploitation", "manager", "comptable", "chauffeur"]) expect(alerteVisiblePour(r, "paiement_echoue", null), r).toBe(false);
  });
});
