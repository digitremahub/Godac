import { describe, expect, it } from "vitest";
import {
  BAREME_PAR_DEFAUT,
  chevauchements,
  dansPeriode,
  montantRemboursement,
  normaliserLigne,
  tauxApplicable,
  type LigneBareme,
  type SurchargeBareme,
} from "@/lib/ticpe/bareme";
import { REGLAGES_PAR_DEFAUT, activiteActive, normaliserReglages, schemaReglages } from "@/lib/ticpe/reglages";

const B = BAREME_PAR_DEFAUT;

describe("tauxApplicable — barème par défaut", () => {
  it("2026 métropole : 15,56 €/hl", () => {
    const r = tauxApplicable("2026-03-15", "trm", "metropole", B);
    expect(r).toMatchObject({ statut: "ok", taux: 15.56, origine: "bareme", zoneRetenue: "metropole" });
  });
  it("2026 Corse : 14,21 €/hl", () => {
    expect(tauxApplicable("2026-12-31", "trm", "corse", B)).toMatchObject({ statut: "ok", taux: 14.21 });
  });
  it("2026 Île-de-France : plus de taux régional → taux métropole", () => {
    expect(tauxApplicable("2026-06-01", "trm", "ile_de_france", B)).toMatchObject({ statut: "ok", taux: 15.56, zoneRetenue: "metropole" });
    expect(tauxApplicable("2026-06-01", "trm", "auvergne_rhone_alpes", B)).toMatchObject({ statut: "ok", taux: 15.56 });
  });
  it("2025 : taux régionaux", () => {
    expect(tauxApplicable("2025-05-01", "trm", "ile_de_france", B)).toMatchObject({ taux: 17.45 });
    expect(tauxApplicable("2025-05-01", "trm", "auvergne_rhone_alpes", B)).toMatchObject({ taux: 15.29 });
    expect(tauxApplicable("2025-05-01", "trm", "metropole", B)).toMatchObject({ taux: 15.56 });
  });
  it("2025 : option forfaitaire pondéré", () => {
    expect(tauxApplicable("2025-05-01", "trm", "ile_de_france", B, [], { forfaitPondere: true })).toMatchObject({ taux: 15.71, zoneRetenue: "forfait_pondere" });
    expect(tauxApplicable("2025-05-01", "trm", "metropole", B, [], { forfaitPondere: true })).toMatchObject({ taux: 15.71 });
  });
  it("2026 : l'option forfaitaire n'a plus de ligne → taux métropole", () => {
    expect(tauxApplicable("2026-05-01", "trm", "metropole", B, [], { forfaitPondere: true })).toMatchObject({ taux: 15.56, zoneRetenue: "metropole" });
  });
  it("la Corse ne retombe jamais sur la métropole ni sur le forfait", () => {
    expect(tauxApplicable("2025-05-01", "trm", "corse", B, [], { forfaitPondere: true })).toMatchObject({ statut: "manquant", zoneRetenue: "corse" });
  });
  it("taux TRV et taxi inconnus : « manquant », jamais inventé", () => {
    const r = tauxApplicable("2026-02-01", "trv", "metropole", B);
    expect(r.statut).toBe("manquant");
    if (r.statut === "manquant") expect(r.raison).toContain("non renseigné");
    expect(tauxApplicable("2026-02-01", "taxi", "corse", B).statut).toBe("manquant");
  });
  it("date hors barème : manquant", () => {
    expect(tauxApplicable("2024-12-31", "trm", "metropole", B)).toMatchObject({ statut: "manquant" });
  });
  it("bornes incluses", () => {
    expect(tauxApplicable("2025-12-31", "trm", "ile_de_france", B)).toMatchObject({ taux: 17.45 });
    expect(tauxApplicable("2026-01-01", "trm", "ile_de_france", B)).toMatchObject({ taux: 15.56 });
  });
  it("accepte un horodatage complet", () => {
    expect(tauxApplicable("2026-01-01T08:00:00.000Z", "trm", "metropole", B)).toMatchObject({ taux: 15.56 });
  });
  it("signale un taux à confirmer", () => {
    expect(tauxApplicable("2026-01-01", "trm", "metropole", B)).toMatchObject({ aConfirmer: true });
  });
});

describe("tauxApplicable — plusieurs lignes et surcharges", () => {
  const bareme: LigneBareme[] = [
    { categorie: "trm", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 15.56 },
    { categorie: "trm", zone: "metropole", date_debut: "2026-07-01", date_fin: null, taux_eur_hl: 16 },
  ];
  it("la ligne commencée le plus tard l'emporte", () => {
    expect(tauxApplicable("2026-06-30", "trm", "metropole", bareme)).toMatchObject({ taux: 15.56 });
    expect(tauxApplicable("2026-07-01", "trm", "metropole", bareme)).toMatchObject({ taux: 16 });
  });
  it("une surcharge active passe avant le barème", () => {
    const s: SurchargeBareme[] = [{ categorie: "trm", zone: "metropole", date_debut: "2026-01-01", date_fin: "2026-03-31", taux_eur_hl: 12, motif: "cas particulier" }];
    expect(tauxApplicable("2026-02-01", "trm", "metropole", bareme, s)).toMatchObject({ taux: 12, origine: "surcharge", aConfirmer: false });
    expect(tauxApplicable("2026-04-01", "trm", "metropole", bareme, s)).toMatchObject({ taux: 15.56, origine: "bareme" });
  });
  it("une surcharge révoquée est ignorée", () => {
    const s: SurchargeBareme[] = [{ categorie: "trm", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 12, motif: "x", revoked_at: "2026-02-01T00:00:00Z" }];
    expect(tauxApplicable("2026-02-01", "trm", "metropole", bareme, s)).toMatchObject({ origine: "bareme" });
  });
  it("une surcharge complète un taux manquant", () => {
    const s: SurchargeBareme[] = [{ categorie: "taxi", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 10, motif: "taux communiqué par l'expert-comptable" }];
    expect(tauxApplicable("2026-05-01", "taxi", "metropole", B, s)).toMatchObject({ statut: "ok", taux: 10, origine: "surcharge" });
  });
  it("surcharge sur la zone de repli (métropole) pour une zone régionale", () => {
    const s: SurchargeBareme[] = [{ categorie: "trm", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 11, motif: "x" }];
    expect(tauxApplicable("2026-05-01", "trm", "ile_de_france", B, s)).toMatchObject({ taux: 11, origine: "surcharge" });
  });
  it("une autre catégorie n'est pas concernée par la surcharge", () => {
    const s: SurchargeBareme[] = [{ categorie: "trv", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 9, motif: "x" }];
    expect(tauxApplicable("2026-05-01", "trm", "metropole", B, s)).toMatchObject({ taux: 15.56 });
  });
});

describe("outils du barème", () => {
  it("montant = litres / 100 × taux, au centime", () => {
    expect(montantRemboursement(100, 15.56)).toBe(15.56);
    expect(montantRemboursement(412.37, 15.56)).toBe(64.16);
    expect(montantRemboursement(0, 15.56)).toBe(0);
    expect(montantRemboursement(40000, 14.21)).toBe(5684);
  });
  it("dansPeriode", () => {
    expect(dansPeriode("2026-01-01", "2026-01-01", null)).toBe(true);
    expect(dansPeriode("2025-12-31", "2026-01-01", null)).toBe(false);
    expect(dansPeriode("2026-02-01", "2026-01-01", "2026-01-31")).toBe(false);
  });
  it("chevauchements", () => {
    expect(chevauchements(B)).toEqual([]);
    const l: LigneBareme[] = [
      { categorie: "trm", zone: "corse", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 1 },
      { categorie: "trm", zone: "corse", date_debut: "2026-06-01", date_fin: "2026-12-31", taux_eur_hl: 2 },
    ];
    expect(chevauchements(l)).toHaveLength(1);
  });
  it("normaliserLigne convertit le numeric texte", () => {
    expect(normaliserLigne({ taux_eur_hl: "15.5600" }).taux_eur_hl).toBe(15.56);
    expect(normaliserLigne({ taux_eur_hl: null }).taux_eur_hl).toBeNull();
  });
});

describe("réglages TICPE", () => {
  it("valeurs par défaut : TRM, CA3 mensuelle, aucun plafond, gazole seul, location demandée par nous", () => {
    expect(normaliserReglages(null)).toEqual(REGLAGES_PAR_DEFAUT);
    expect(REGLAGES_PAR_DEFAUT).toMatchObject({ activite_trm: true, activite_taxi: false, regime_tva: "mensuel", plafond_actif: false, plafond_litres: null, accepte_hvo_b100: false, location_demandeur: "nous" });
  });
  it("normalise une ligne lue en base", () => {
    const r = normaliserReglages({ regime_tva: "trimestriel", plafond_actif: true, plafond_litres: "20000", plafond_periode: "semestriel", jour_limite_depot: 19, inconnu: 1 });
    expect(r).toMatchObject({ regime_tva: "trimestriel", plafond_actif: true, plafond_litres: 20000, plafond_periode: "semestriel", jour_limite_depot: 19 });
  });
  it("valeurs invalides → défaut", () => {
    const r = normaliserReglages({ regime_tva: "hebdo", plafond_litres: -5, jour_limite_depot: 40, activite_trm: false, activite_trv: false, activite_taxi: false });
    expect(r.regime_tva).toBe("mensuel");
    expect(r.plafond_litres).toBeNull();
    expect(r.plafond_actif).toBe(false);
    expect(r.jour_limite_depot).toBeNull();
    expect(r.activite_trm).toBe(true);
  });
  it("ligne ancienne (40000 par défaut, sans colonne plafond_actif) : aucun plafond appliqué", () => {
    const r = normaliserReglages({ plafond_litres: 40000, plafond_periode: "annuel" });
    expect(r).toMatchObject({ plafond_actif: false, plafond_litres: 40000 });
  });
  it("schéma : plafond activé sans litres refusé", () => {
    expect(schemaReglages.safeParse({ ...REGLAGES_PAR_DEFAUT, plafond_actif: true, plafond_litres: null }).success).toBe(false);
    expect(schemaReglages.safeParse({ ...REGLAGES_PAR_DEFAUT, plafond_actif: true, plafond_litres: 30000 }).success).toBe(true);
  });
  it("schéma : au moins une activité, catégorie par défaut cochée", () => {
    expect(schemaReglages.safeParse(REGLAGES_PAR_DEFAUT).success).toBe(true);
    expect(schemaReglages.safeParse({ ...REGLAGES_PAR_DEFAUT, activite_trm: false }).success).toBe(false);
    expect(schemaReglages.safeParse({ ...REGLAGES_PAR_DEFAUT, categorie_par_defaut: "taxi" }).success).toBe(false);
    expect(schemaReglages.safeParse({ ...REGLAGES_PAR_DEFAUT, activite_taxi: true, categorie_par_defaut: "taxi" }).success).toBe(true);
    expect(schemaReglages.safeParse({ ...REGLAGES_PAR_DEFAUT, date_limite_ca12: "5 mai" }).success).toBe(false);
  });
  it("activiteActive", () => {
    expect(activiteActive(REGLAGES_PAR_DEFAUT, "trm")).toBe(true);
    expect(activiteActive(REGLAGES_PAR_DEFAUT, "taxi")).toBe(false);
  });
});
