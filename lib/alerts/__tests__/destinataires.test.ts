import { describe, expect, it } from "vitest";
import { TYPES_ALERTE_TOURNEE, alerteAffichable, choisirDestinataires, estLimiteAuService, peutChangerStatutAlerte, rolesCibles } from "@/lib/alerts/destinataires";

const gens = [
  { id: "m1", role: "manager" },
  { id: "m2", role: "manager" },
  { id: "e1", role: "exploitation" },
  { id: "d1", role: "direction" },
  { id: "c1", role: "comptable" },
];
const services = new Map([
  ["m1", ["A"]],
  ["m2", ["B"]],
]);

describe("destinataires d'une alerte (e-mail, push)", () => {
  it("alerte d'un service : seul le manager de ce service, exploitation et direction partout", () => {
    expect(choisirDestinataires(gens, { service_id: "A" }, services).map((g) => g.id)).toEqual(["m1", "e1", "d1", "c1"]);
    expect(choisirDestinataires(gens, { service_id: "B" }, services).map((g) => g.id)).toEqual(["m2", "e1", "d1", "c1"]);
  });
  it("alerte sans service : tous les managers", () => {
    expect(choisirDestinataires(gens, { service_id: null }, services)).toHaveLength(5);
    expect(choisirDestinataires(gens, {}, services)).toHaveLength(5);
  });
  it("manager sans service connu : pas d'alerte de service", () => {
    expect(choisirDestinataires([{ id: "m3", role: "manager" }], { service_id: "A" }, services)).toEqual([]);
  });
  it("seuls les managers sont limités au service", () => {
    expect(estLimiteAuService("manager", "A")).toBe(true);
    expect(estLimiteAuService("exploitation", "A")).toBe(false);
    expect(estLimiteAuService("direction", "A")).toBe(false);
    expect(estLimiteAuService("manager", null)).toBe(false);
  });
  it("rôles ciblés : l'exploitation suit les managers, défaut direction et exploitation", () => {
    expect(rolesCibles(["manager"]).sort()).toEqual(["exploitation", "manager"]);
    expect(rolesCibles([]).sort()).toEqual(["direction", "exploitation"]);
  });
});

describe("alertes de tournée (surveillance) : périmètre par rôle", () => {
  const tournee = { type: "tournee_non_demarree", service_id: "A" };
  it("un manager d'un autre service, le comptable et le chauffeur ne les reçoivent pas", () => {
    expect(choisirDestinataires(gens, tournee, services).map((g) => g.id)).toEqual(["m1", "e1", "d1"]);
    expect(choisirDestinataires([{ id: "x", role: "chauffeur" }], tournee, services)).toEqual([]);
  });
  it("tournée sans service : exploitation et direction seulement, aucun manager", () => {
    for (const type of TYPES_ALERTE_TOURNEE) expect(choisirDestinataires(gens, { type, service_id: null }, services).map((g) => g.id), type).toEqual(["e1", "d1"]);
  });
  it("les autres types d'alerte sans service restent diffusés à tous les managers", () => {
    expect(choisirDestinataires(gens, { type: "price_anomaly", service_id: null }, services)).toHaveLength(5);
  });
  it("filet de lecture : comptable et manager sans service n'affichent pas ces alertes", () => {
    expect(alerteAffichable("comptable", { type: "tournee_retard", service_id: "A" })).toBe(false);
    expect(alerteAffichable("manager", { type: "tournee_retard", service_id: null })).toBe(false);
    expect(alerteAffichable("manager", { type: "tournee_retard", service_id: "A" })).toBe(true);
    expect(alerteAffichable("exploitation", { type: "tournee_retard", service_id: null })).toBe(true);
    expect(alerteAffichable("comptable", { type: "fuel_gap", service_id: null })).toBe(true);
  });
});

describe("statut partagé d'une alerte : qui peut prendre en compte / résoudre", () => {
  const base = { userId: "u1", mesServices: ["A"] };
  const diffusee = { type: "price_anomaly", service_id: "A", recipient_user_id: null };
  it("un chauffeur ne résout jamais une alerte, même la sienne", () => {
    expect(peutChangerStatutAlerte({ ...base, role: "chauffeur", statut: "resolved", alerte: { ...diffusee, recipient_user_id: "u1" } }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ ...base, role: "chauffeur", statut: "resolved", alerte: diffusee }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ ...base, role: "chauffeur", statut: "acknowledged", alerte: { ...diffusee, recipient_user_id: "u1" } }).ok).toBe(true);
    expect(peutChangerStatutAlerte({ ...base, role: "chauffeur", statut: "acknowledged", alerte: { ...diffusee, recipient_user_id: "autre" } }).ok).toBe(false);
  });
  it("le comptable ne traite pas les alertes diffusées", () => {
    expect(peutChangerStatutAlerte({ ...base, role: "comptable", statut: "resolved", alerte: diffusee }).ok).toBe(false);
  });
  it("le manager ne traite que les alertes de ses services", () => {
    expect(peutChangerStatutAlerte({ ...base, role: "manager", statut: "resolved", alerte: diffusee }).ok).toBe(true);
    expect(peutChangerStatutAlerte({ ...base, role: "manager", statut: "resolved", alerte: { ...diffusee, service_id: "B" } }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ ...base, role: "manager", statut: "resolved", alerte: { type: "tournee_retard", service_id: null, recipient_user_id: null } }).ok).toBe(false);
  });
  it("exploitation et direction traitent partout", () => {
    for (const role of ["exploitation", "direction"]) expect(peutChangerStatutAlerte({ ...base, role, statut: "resolved", alerte: { ...diffusee, service_id: "B" } }).ok, role).toBe(true);
  });
});
