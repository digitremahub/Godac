import { describe, expect, it } from "vitest";
import { controlerApprobation, controlerDemande, messageAffectationsConge } from "@/lib/leaves/controle";
import { affectationsALiberer } from "@/lib/arrets/declaration";

const solde = (disponibleApresAttente: number, repriseRenseignee = true) => ({ disponibleApresAttente, repriseRenseignee });
const base = { du: "2026-11-02", au: "2026-11-06", serviceId: "s1", servicesDuDemandeur: ["s1"], existants: [], solde: solde(10), confirmerSoldeInsuffisant: false };

describe("controlerDemande (serveur)", () => {
  it("demande valide", () => expect(controlerDemande(base).ok).toBe(true));
  it("service qui n'est pas le sien : 403", () => expect(controlerDemande({ ...base, serviceId: "s9" })).toMatchObject({ ok: false, status: 403, code: "SERVICE_INVALIDE" }));
  it("chevauchement avec sa propre demande : 409", () => {
    expect(controlerDemande({ ...base, existants: [{ du: "2026-11-05", au: "2026-11-10", status: "approved" }] })).toMatchObject({ ok: false, code: "CHEVAUCHEMENT" });
    expect(controlerDemande({ ...base, existants: [{ du: "2026-11-05", au: "2026-11-10", status: "rejected" }] }).ok).toBe(true);
  });
  it("solde insuffisant : confirmation explicite exigée", () => {
    const court = { ...base, solde: solde(2) };
    expect(controlerDemande(court)).toMatchObject({ ok: false, status: 409, code: "SOLDE_INSUFFISANT" });
    expect(controlerDemande({ ...court, confirmerSoldeInsuffisant: true }).ok).toBe(true);
  });
  it("solde de reprise non renseigné : pas de blocage", () => expect(controlerDemande({ ...base, solde: solde(0, false) }).ok).toBe(true));
});

describe("controlerApprobation", () => {
  const appro = { idDemande: "c1", du: "2026-11-02", au: "2026-11-06", existants: [{ id: "c1", du: "2026-11-02", au: "2026-11-06", status: "pending" }], solde: solde(0), confirmerSoldeInsuffisant: false };
  it("la demande elle-même (en attente) est comptée : solde de 5 j sans elle suffit", () => {
    expect(controlerApprobation({ ...appro, solde: solde(0) }).ok).toBe(true);
  });
  it("solde insuffisant sans confirmation : 409", () => {
    expect(controlerApprobation({ ...appro, solde: solde(-3) })).toMatchObject({ ok: false, code: "SOLDE_INSUFFISANT" });
    expect(controlerApprobation({ ...appro, solde: solde(-3), confirmerSoldeInsuffisant: true }).ok).toBe(true);
  });
  it("congé approuvé qui se recouvre : 409", () => {
    expect(controlerApprobation({ ...appro, existants: [...appro.existants, { id: "c2", du: "2026-11-04", au: "2026-11-05", status: "approved" }] })).toMatchObject({ ok: false, code: "CHEVAUCHEMENT" });
  });
});

describe("congés ↔ planning", () => {
  it("seules les affectations prévues et à venir sont libérées", () => {
    const e = [
      { id: "a", start_at: "2026-11-03T06:00:00Z", status: "planned" },
      { id: "b", start_at: "2026-11-04T06:00:00Z", status: "in_progress" },
      { id: "c", start_at: "2026-11-20T06:00:00Z", status: "planned" },
    ];
    expect(affectationsALiberer(e, { du: "2026-11-02", au: "2026-11-06" }, new Date("2026-10-27T00:00:00Z")).map((x) => x.id)).toEqual(["a"]);
  });
  it("message à l'encadrement", () => expect(messageAffectationsConge({ nom: "Marie", du: "2026-11-02", au: "2026-11-06", nombre: 2 })).toContain("2 affectations"));
});
