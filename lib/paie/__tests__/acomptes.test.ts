import { describe, expect, it } from "vitest";
import {
  acomptesDuBulletin,
  actionAcompte,
  fusionnerRetenues,
  libelleAcompte,
  moisDeDeduction,
  moisSuivant,
  plafondAcompte,
  verifierDemande,
  type DemandeAcompte,
} from "../acomptes";
import { calculerBulletin } from "../calcul";
import { parametresLegauxAu } from "../parametres";

const demande = (p: Partial<DemandeAcompte>): DemandeAcompte => ({
  id: "d1",
  user_id: "u1",
  period: "2026-10-01",
  amount_requested: 300,
  amount_granted: null,
  reason: null,
  status: "acceptee",
  decided_at: "2026-10-12T09:00:00Z",
  decision_comment: null,
  paid_at: "2026-10-14",
  payslip_id: null,
  original_period: null,
  created_at: "2026-10-10T08:00:00Z",
  ...p,
});

describe("plafondAcompte", () => {
  it("50 % du net habituel par défaut, arrondi à l'euro inférieur", () => {
    expect(plafondAcompte({ netHabituel: 1801.5 })).toBe(900);
  });
  it("le montant fixe l'emporte", () => {
    expect(plafondAcompte({ netHabituel: 2000, pourcentage: 50, montantFixe: 400 })).toBe(400);
  });
  it("sans bulletin validé : pas de plafond", () => {
    expect(plafondAcompte({ netHabituel: null })).toBeNull();
  });
});

describe("verifierDemande", () => {
  it("refuse un montant nul et une deuxième demande en attente", () => {
    expect(verifierDemande({ montant: 0, plafond: 500, demandesDuMois: [] }).ok).toBe(false);
    expect(verifierDemande({ montant: 100, plafond: 500, demandesDuMois: [{ status: "en_attente" }] }).ok).toBe(false);
  });
  it("au-delà du plafond : accepté avec avertissement", () => {
    const r = verifierDemande({ montant: 600, plafond: 500, demandesDuMois: [{ status: "refusee" }] });
    expect(r.ok && r.avertissement).toMatch(/plafond indicatif/);
  });
});

describe("actionAcompte", () => {
  it("l'auteur annule seulement en attente", () => {
    expect(actionAcompte({ role: "chauffeur", estAuteur: true, action: "annuler", statut: "en_attente" })).toMatchObject({ ok: true, statut: "annulee" });
    expect(actionAcompte({ role: "chauffeur", estAuteur: true, action: "annuler", statut: "acceptee" }).ok).toBe(false);
  });
  it("le comptable prépare mais ne décide pas", () => {
    expect(actionAcompte({ role: "comptable", estAuteur: false, action: "preparer", statut: "en_attente", montant: 200 }).ok).toBe(true);
    expect(actionAcompte({ role: "comptable", estAuteur: false, action: "accepter", statut: "en_attente", montant: 200 }).ok).toBe(false);
    expect(actionAcompte({ role: "comptable", estAuteur: false, action: "verser", statut: "acceptee" }).ok).toBe(true);
  });
  it("la direction accepte, refuse avec motif", () => {
    expect(actionAcompte({ role: "direction", estAuteur: false, action: "accepter", statut: "en_attente", montant: 250 })).toMatchObject({ ok: true, statut: "acceptee", decision: true });
    expect(actionAcompte({ role: "direction", estAuteur: false, action: "refuser", statut: "en_attente", commentaire: " " }).ok).toBe(false);
    expect(actionAcompte({ role: "direction", estAuteur: false, action: "refuser", statut: "en_attente", commentaire: "Trésorerie" }).ok).toBe(true);
    expect(actionAcompte({ role: "direction", estAuteur: false, action: "accepter", statut: "refusee", montant: 250 }).ok).toBe(false);
  });
  it("un chauffeur ne décide jamais", () => {
    expect(actionAcompte({ role: "chauffeur", estAuteur: true, action: "accepter", statut: "en_attente", montant: 100 }).ok).toBe(false);
  });
});

describe("mois", () => {
  it("moisSuivant passe l'année", () => {
    expect(moisSuivant("2026-12")).toBe("2027-01");
    expect(moisSuivant("2026-09")).toBe("2026-10");
  });
  it("moisDeDeduction saute les bulletins validés", () => {
    expect(moisDeDeduction("2026-10", new Set(["2026-10", "2026-11"]))).toBe("2026-12");
    expect(moisDeDeduction("2026-10", new Set())).toBe("2026-10");
  });
});

describe("acomptesDuBulletin", () => {
  it("ajoute « Acompte du JJ/MM » avec le montant accordé", () => {
    const r = acomptesDuBulletin({ demandes: [demande({ amount_granted: 250 })], mois: "2026-10", bulletin: null });
    expect(r.retenues).toEqual([{ type: "acompte", libelle: "Acompte du 14/10", montant: 250, demandeId: "d1" }]);
    expect(r.ids).toEqual(["d1"]);
  });
  it("ignore les demandes non acceptées, d'un mois futur ou déjà déduites ailleurs", () => {
    const r = acomptesDuBulletin({
      demandes: [
        demande({ id: "a", status: "en_attente" }),
        demande({ id: "b", status: "refusee" }),
        demande({ id: "c", period: "2026-11-01" }),
        demande({ id: "d", payslip_id: "autre" }),
      ],
      mois: "2026-10",
      bulletin: { id: "p10", valide: false },
    });
    expect(r.ids).toEqual([]);
  });
  it("bulletin validé : jamais complété, l'acompte passe au mois suivant", () => {
    const r = acomptesDuBulletin({
      demandes: [demande({ id: "deja", payslip_id: "p10" }), demande({ id: "neuf" })],
      mois: "2026-10",
      bulletin: { id: "p10", valide: true },
    });
    expect(r.ids).toEqual(["deja"]);
    expect(r.avertissements.join(" ")).toMatch(/11\/2026/);
  });
  it("reprend un acompte d'un mois antérieur non déduit, avec avertissement", () => {
    const r = acomptesDuBulletin({ demandes: [demande({ period: "2026-09-01", paid_at: "2026-09-20" })], mois: "2026-10", bulletin: null });
    expect(r.ids).toEqual(["d1"]);
    expect(r.avertissements[0]).toMatch(/reporté de 09\/2026/);
  });
  it("libellé : date de décision à défaut de versement", () => {
    expect(libelleAcompte({ paid_at: null, decided_at: "2026-10-03T10:00:00Z", created_at: "2026-10-01T10:00:00Z" })).toBe("Acompte du 03/10");
  });
});

describe("fusionnerRetenues", () => {
  it("écarte les lignes d'acompte venues du navigateur et garde les saisies", () => {
    const r = fusionnerRetenues(
      [
        { type: "saisie", libelle: "Greffe", montant: 50 },
        { type: "acompte", libelle: "Acompte du 01/10", montant: 9999, demandeId: "x" },
      ],
      [{ type: "acompte", libelle: "Acompte du 14/10", montant: 250, demandeId: "d1" }],
    );
    expect(r.map((x) => x.montant)).toEqual([50, 250]);
  });
});

describe("intégration au calcul", () => {
  it("la ligne d'acompte est déduite du net à payer avec son libellé", () => {
    const legal = parametresLegauxAu("2026-10-01");
    const b = calculerBulletin({
      legal,
      entreprise: {
        effectif: 5,
        tauxAccidentTravail: 2,
        tauxVersementMobilite: 0,
        prevoyance: { salarial: 0, patronal: 0 },
        mutuelle: { salarial: 0, patronal: 0 },
        frais: { repas: 15, repasUnique: 15, cassecroute: 8, grandDeplacement: 50 },
      },
      salarie: { regime: "sedentaire", cadre: false, tauxHoraire: 13, heuresContractuelles: 151.67, tauxPas: 0 },
      variables: {
        heuresTravaillees: null,
        heuresAbsenceNonPayee: 0,
        joursCongesPris: 0,
        primes: [],
        nbRepas: 0,
        nbRepasUnique: 0,
        nbCasseCroute: 0,
        nbGrandDeplacement: 0,
        cumulHeuresSupExonereesAnnee: 0,
        retenues: [{ type: "acompte", libelle: "Acompte du 14/10", montant: 250, demandeId: "d1" }],
      },
    });
    expect(b.totalRetenues).toBe(250);
    expect(b.netAPayer).toBeCloseTo(b.netAvantRetenues - 250, 2);
    expect(b.lignes.some((l) => l.libelle === "Acompte du 14/10" && l.montantSalarial === 250)).toBe(true);
  });
});
