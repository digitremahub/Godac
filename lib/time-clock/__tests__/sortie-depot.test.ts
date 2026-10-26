import { describe, expect, it } from "vitest";
import {
  DELAI_ANNULATION_SORTIE_MS,
  FRAICHEUR_PRESENCE_MS,
  decider,
  heureSortieDernierePresence,
  presenceValide,
  refusAnnulationSortie,
  tourneeClotureeDepuisArrivee,
  type EntreeDecision,
} from "../sortie-depot";

const maintenant = new Date("2026-10-23T15:00:00Z");
const arrivee = "2026-10-23T05:30:00Z";
const il_y_a = (min: number) => new Date(maintenant.getTime() - min * 60_000).toISOString();

/** Chauffeur pointé, hors du dépôt, tournée close, vu au dépôt il y a 2 minutes. */
const base: EntreeDecision = {
  organisationActive: true,
  entreeOuverte: true,
  clockedInAt: arrivee,
  positionPrecise: true,
  auDepot: false,
  loinDuDepot: true,
  entreeAuto: false,
  tourneeEnCours: false,
  tourneeCloturee: true,
  lastDepotSeenAt: il_y_a(2),
  maintenant,
};

describe("decider", () => {
  it("sortie automatique à l'heure de la dernière présence, jamais « maintenant »", () => {
    const d = decider(base);
    expect(d).toEqual({ action: "sortie_auto", clockedOutAt: il_y_a(2) });
    if (d.action === "sortie_auto") expect(new Date(d.clockedOutAt).getTime()).toBeLessThan(maintenant.getTime());
  });

  it("présence tout juste fraîche (60 min) : sortie automatique ; 61 min : simple offre", () => {
    expect(decider({ ...base, lastDepotSeenAt: il_y_a(60) }).action).toBe("sortie_auto");
    const d = decider({ ...base, lastDepotSeenAt: il_y_a(61) });
    expect(d).toEqual({ action: "offre", lastSeenAt: il_y_a(61) });
    expect(FRAICHEUR_PRESENCE_MS).toBe(60 * 60_000);
  });

  it("chargement de 40 min au dépôt, app fermée : la présence d'il y a 45 min suffit pour la sortie automatique", () => {
    expect(decider({ ...base, lastDepotSeenAt: il_y_a(45) })).toEqual({ action: "sortie_auto", clockedOutAt: il_y_a(45) });
  });

  it("app ouverte seulement après avoir quitté le dépôt : entrée automatique récente sans présence → sortie à l'arrivée", () => {
    const arriveeRecente = il_y_a(40);
    expect(decider({ ...base, clockedInAt: arriveeRecente, entreeAuto: true, lastDepotSeenAt: null })).toEqual({ action: "sortie_auto", clockedOutAt: arriveeRecente });
  });

  it("entrée automatique ancienne sans présence : offre sans heure (jamais une sortie à l'arrivée du matin)", () => {
    expect(decider({ ...base, entreeAuto: true, lastDepotSeenAt: null })).toEqual({ action: "offre", lastSeenAt: null });
  });

  it("entrée manuelle récente sans présence : offre, aucune heure déduite", () => {
    expect(decider({ ...base, clockedInAt: il_y_a(40), entreeAuto: false, lastDepotSeenAt: null })).toEqual({ action: "offre", lastSeenAt: null });
  });

  it("zone tampon (au-delà du rayon d'arrivée, en deçà de la marge) : rien, ni sortie ni offre", () => {
    expect(decider({ ...base, loinDuDepot: false })).toEqual({ action: "rien", raison: "proche_du_depot" });
  });

  it("démarrage de tournée hors dépôt : tournée en cours, jamais de sortie", () => {
    expect(decider({ ...base, tourneeEnCours: true, tourneeCloturee: false })).toEqual({ action: "rien", raison: "tournee_en_cours" });
  });

  it("GPS imprécis (fix réseau) : rien, même tournée close et présence fraîche", () => {
    expect(decider({ ...base, positionPrecise: false })).toEqual({ action: "rien", raison: "position_imprecise" });
  });

  it("déjà sorti (plus d'entrée ouverte) : jamais deux sorties", () => {
    expect(decider({ ...base, entreeOuverte: false, clockedInAt: null })).toEqual({ action: "rien", raison: "pas_d_entree" });
  });

  it("jamais de sortie rétroactive de plusieurs heures : présence du matin → offre", () => {
    const d = decider({ ...base, lastDepotSeenAt: "2026-10-23T05:40:00Z" });
    expect(d.action).toBe("offre");
  });

  it("aucune présence mémorisée (app fermée au départ) → offre sans heure", () => {
    expect(decider({ ...base, lastDepotSeenAt: null })).toEqual({ action: "offre", lastSeenAt: null });
  });

  it("présence antérieure à l'arrivée ou dans le futur : ignorée", () => {
    expect(decider({ ...base, lastDepotSeenAt: "2026-10-22T18:00:00Z" })).toEqual({ action: "offre", lastSeenAt: null });
    expect(decider({ ...base, lastDepotSeenAt: new Date(maintenant.getTime() + 10 * 60_000).toISOString() })).toEqual({ action: "offre", lastSeenAt: null });
    expect(decider({ ...base, lastDepotSeenAt: "pas une date" })).toEqual({ action: "offre", lastSeenAt: null });
  });

  it("au dépôt : on mémorise la présence, jamais de sortie", () => {
    expect(decider({ ...base, auDepot: true })).toEqual({ action: "maj_presence" });
    expect(decider({ ...base, auDepot: true, tourneeEnCours: true })).toEqual({ action: "maj_presence" });
  });

  it("tournée en cours : rien", () => {
    expect(decider({ ...base, tourneeEnCours: true })).toEqual({ action: "rien", raison: "tournee_en_cours" });
  });

  it("aucune tournée clôturée depuis l'arrivée : rien (ni sortie ni offre)", () => {
    expect(decider({ ...base, tourneeCloturee: false })).toEqual({ action: "rien", raison: "tournee_non_cloturee" });
    expect(decider({ ...base, tourneeCloturee: false, lastDepotSeenAt: null })).toEqual({ action: "rien", raison: "tournee_non_cloturee" });
  });

  it("position imprécise : rien, même loin du dépôt", () => {
    expect(decider({ ...base, positionPrecise: false })).toEqual({ action: "rien", raison: "position_imprecise" });
    expect(decider({ ...base, positionPrecise: false, auDepot: true })).toEqual({ action: "rien", raison: "position_imprecise" });
  });

  it("organisation désactivée : aucune sortie, aucune offre", () => {
    expect(decider({ ...base, organisationActive: false })).toEqual({ action: "rien", raison: "organisation_desactivee" });
  });

  it("pas d'entrée ouverte : rien", () => {
    expect(decider({ ...base, entreeOuverte: false })).toEqual({ action: "rien", raison: "pas_d_entree" });
  });
});

describe("presenceValide", () => {
  it("renvoie la date si elle est dans l'intervalle [arrivée, maintenant]", () => {
    expect(presenceValide(il_y_a(5), arrivee, maintenant)?.toISOString()).toBe(il_y_a(5));
    expect(presenceValide(null, arrivee, maintenant)).toBeNull();
  });
});

describe("tourneeClotureeDepuisArrivee", () => {
  const params = { clockedInAt: "2026-10-23T05:30:00Z", runsClotures: [], planningCloture: [] };
  it("tournée colis clôturée le jour d'arrivée (heure de Paris)", () => {
    expect(tourneeClotureeDepuisArrivee({ ...params, runsClotures: [{ run_date: "2026-10-23" }] })).toBe(true);
    expect(tourneeClotureeDepuisArrivee({ ...params, runsClotures: [{ run_date: "2026-10-22" }] })).toBe(false);
  });
  it("arrivée à 23 h 30 UTC = lendemain à Paris : la tournée de la veille ne compte pas", () => {
    expect(tourneeClotureeDepuisArrivee({ ...params, clockedInAt: "2026-10-22T23:30:00Z", runsClotures: [{ run_date: "2026-10-22" }] })).toBe(false);
  });
  it("tournée du planning clôturée après l'arrivée, pas avant", () => {
    expect(tourneeClotureeDepuisArrivee({ ...params, planningCloture: [{ end_at: "2026-10-23T14:00:00Z" }] })).toBe(true);
    expect(tourneeClotureeDepuisArrivee({ ...params, planningCloture: [{ end_at: "2026-10-23T05:00:00Z" }, { end_at: null }] })).toBe(false);
  });
  it("aucune tournée : faux", () => {
    expect(tourneeClotureeDepuisArrivee(params)).toBe(false);
  });
});

describe("refusAnnulationSortie", () => {
  const sortie = { id: "e1", user_id: "u1", auto_clocked_out: true, clocked_out_at: il_y_a(10) };
  it("autorise l'annulation d'une sortie automatique récente, dernière entrée, sans entrée ouverte", () => {
    expect(refusAnnulationSortie(sortie, "u1", "e1", false, maintenant)).toBeNull();
  });
  it("refuse une sortie non automatique (manuelle)", () => {
    expect(refusAnnulationSortie({ ...sortie, auto_clocked_out: false }, "u1", "e1", false, maintenant)).toMatch(/pas été pointée automatiquement/);
  });
  it("refuse si ce n'est plus la dernière entrée", () => {
    expect(refusAnnulationSortie(sortie, "u1", "e2", false, maintenant)).toMatch(/plus récent/);
  });
  it("refuse si une entrée est déjà ouverte", () => {
    expect(refusAnnulationSortie(sortie, "u1", "e1", true, maintenant)).toMatch(/déjà pointé/);
  });
  it("refuse l'entrée d'un autre utilisateur", () => {
    expect(refusAnnulationSortie(sortie, "u2", "e1", false, maintenant)).toMatch(/introuvable/);
  });
  it("refuse au-delà de 2 h (sinon la bascule manuelle fabriquerait des heures)", () => {
    const vieille = { ...sortie, clocked_out_at: new Date(maintenant.getTime() - DELAI_ANNULATION_SORTIE_MS - 60_000).toISOString() };
    expect(refusAnnulationSortie(vieille, "u1", "e1", false, maintenant)).toMatch(/plus de 2 heures/);
  });
});

describe("heureSortieDernierePresence", () => {
  it("l'heure de sortie est la dernière présence en base", () => {
    expect(heureSortieDernierePresence({ lastDepotSeenAt: il_y_a(90), clockedInAt: arrivee, maintenant })).toEqual({ ok: true, at: il_y_a(90) });
  });
  it("refuse sans présence valide depuis l'arrivée", () => {
    expect(heureSortieDernierePresence({ lastDepotSeenAt: null, clockedInAt: arrivee, maintenant }).ok).toBe(false);
    expect(heureSortieDernierePresence({ lastDepotSeenAt: "2026-10-23T04:00:00Z", clockedInAt: arrivee, maintenant }).ok).toBe(false);
  });
});
