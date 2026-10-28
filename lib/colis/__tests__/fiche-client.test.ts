import { describe, expect, it } from "vitest";
import {
  DUREE_SERVICE_MAX,
  DUREE_SERVICE_MIN,
  ECART_CLOTURE_MAX_MIN,
  FENETRE_MOYENNE,
  COMPTEUR_MAX,
  consignesDepuisNotes,
  creneauConseille,
  creneauReussite,
  derniereNonVide,
  detailSuggestion,
  dureeObservee,
  dureeServicePrevue,
  echecFrequent,
  fusionnerObservation,
  lireDonnees,
  lireMotifs,
  lireReussites,
  libelleDuree,
  moyenneGlissante,
  prerempli,
  resumeFiche,
  retenirAdresse,
  serviceConnu,
  type ObservationArret,
} from "@/lib/colis/fiche-client";
import { MINUTES_PAR_ARRET } from "@/lib/colis/estimation";

const obs = (o: Partial<ObservationArret> = {}): ObservationArret => ({ statut: "delivered", heure: 10, quand: "2026-10-20T08:00:00.000Z", ...o });

describe("derniereNonVide : jamais d'écrasement par une valeur vide", () => {
  it("la nouvelle valeur non vide gagne", () => {
    expect(derniereNonVide("05 56 00 00 00", "05 56 11 11 11", 40)).toBe("05 56 11 11 11");
  });
  it("une valeur vide, blanche ou absente conserve l'ancienne", () => {
    expect(derniereNonVide("05 56 00 00 00", "", 40)).toBe("05 56 00 00 00");
    expect(derniereNonVide("05 56 00 00 00", "   ", 40)).toBe("05 56 00 00 00");
    expect(derniereNonVide("05 56 00 00 00", null, 40)).toBe("05 56 00 00 00");
    expect(derniereNonVide("05 56 00 00 00", undefined, 40)).toBe("05 56 00 00 00");
  });
  it("tout vide : null ; espaces compactés ; longueur bornée", () => {
    expect(derniereNonVide(null, "  ", 40)).toBeNull();
    expect(derniereNonVide(null, "  Code   1234  ", 40)).toBe("Code 1234");
    expect(derniereNonVide(null, "x".repeat(900), 500)).toHaveLength(500);
  });
});

describe("moyenneGlissante : bornée et glissante", () => {
  it("première observation : elle-même", () => {
    expect(moyenneGlissante(null, 0, 5)).toBe(5);
    expect(moyenneGlissante(undefined, 3, 5)).toBe(5);
  });
  it("moyenne arithmétique tant que la fenêtre n'est pas pleine", () => {
    let m = moyenneGlissante(null, 0, 4);
    m = moyenneGlissante(m, 1, 6);
    expect(m).toBe(5);
    m = moyenneGlissante(m, 2, 8);
    expect(m).toBeCloseTo(6, 1);
  });
  it("au-delà de la fenêtre, la moyenne suit l'évolution récente (poids 1/10)", () => {
    expect(moyenneGlissante(10, 500, 20)).toBeCloseTo(10 + 10 / FENETRE_MOYENNE, 1);
    let m: number = 10;
    for (let i = 0; i < 100; i++) m = moyenneGlissante(m, 100 + i, 20);
    expect(m).toBeGreaterThan(19.5);
  });
  it("chaque observation est bornée à 1–30 min : une valeur aberrante ne dérègle pas la moyenne", () => {
    expect(moyenneGlissante(null, 0, 500)).toBe(DUREE_SERVICE_MAX);
    expect(moyenneGlissante(null, 0, -4)).toBe(DUREE_SERVICE_MIN);
    expect(moyenneGlissante(5, 20, 9999)).toBeLessThanOrEqual(5 + (DUREE_SERVICE_MAX - 5) / FENETRE_MOYENNE + 0.1);
    expect(moyenneGlissante(5, 20, 9999)).toBeLessThanOrEqual(DUREE_SERVICE_MAX);
  });
  it("résultat toujours entre 1 et 30", () => {
    for (const [m, n, o] of [[1, 5, 0], [30, 5, 1000], [12, 0, 7], [Number.NaN, 4, 6]] as const) {
      const r = moyenneGlissante(m, n, o);
      expect(r).toBeGreaterThanOrEqual(DUREE_SERVICE_MIN);
      expect(r).toBeLessThanOrEqual(DUREE_SERVICE_MAX);
    }
  });
});

describe("dureeObservee : écart entre deux clôtures moins le trajet", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 20, 8, min)).toISOString();
  const p = { lat: 45, lng: 5 };
  it("sans trajet connu : l'écart entier", () => {
    expect(dureeObservee({ doneAt: t(0) }, { doneAt: t(6) })).toBe(6);
  });
  it("retire le trajet estimé entre les deux adresses", () => {
    const loin = { lat: 45, lng: 5.1 }; // ≈ 7,9 km à vol d'oiseau, ≈ 17 min à 35 km/h avec facteur routier
    const d = dureeObservee({ doneAt: t(0), point: p }, { doneAt: t(25), point: loin });
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(25);
    expect(d!).toBeGreaterThanOrEqual(DUREE_SERVICE_MIN);
  });
  it("incohérent : aucune observation", () => {
    expect(dureeObservee(null, { doneAt: t(5) })).toBeNull();
    expect(dureeObservee({ doneAt: t(5) }, { doneAt: t(5) })).toBeNull();
    expect(dureeObservee({ doneAt: t(10) }, { doneAt: t(5) })).toBeNull();
    expect(dureeObservee({ doneAt: t(0) }, { doneAt: t(ECART_CLOTURE_MAX_MIN + 1) })).toBeNull(); // pause
    expect(dureeObservee({ doneAt: "n'importe quoi" }, { doneAt: t(5) })).toBeNull();
  });
  it("trajet estimé plus long que l'écart : rien à apprendre", () => {
    const loin = { lat: 45, lng: 5.3 };
    expect(dureeObservee({ doneAt: t(0), point: p }, { doneAt: t(10), point: loin })).toBeNull();
  });
  it("durée bornée à 30 min", () => {
    expect(dureeObservee({ doneAt: t(0) }, { doneAt: t(44) })).toBe(DUREE_SERVICE_MAX);
  });
});

describe("dureeServicePrevue : l'historique remplace la valeur fixe", () => {
  it("valeur fixe sans fiche, sans moyenne ou avec trop peu d'observations", () => {
    expect(dureeServicePrevue(null)).toBe(MINUTES_PAR_ARRET);
    expect(dureeServicePrevue({ service_avg_min: null, service_samples: 0 })).toBe(MINUTES_PAR_ARRET);
    expect(dureeServicePrevue({ service_avg_min: 9, service_samples: 1 })).toBe(MINUTES_PAR_ARRET);
  });
  it("moyenne observée dès 2 passages ; chaînes numériques de Postgres acceptées", () => {
    expect(dureeServicePrevue({ service_avg_min: 7.5, service_samples: 2 })).toBe(7.5);
    expect(dureeServicePrevue({ service_avg_min: "7.5", service_samples: 4 })).toBe(7.5);
  });
  it("valeur aberrante stockée : bornée", () => {
    expect(dureeServicePrevue({ service_avg_min: 400, service_samples: 9 })).toBe(DUREE_SERVICE_MAX);
    expect(dureeServicePrevue({ service_avg_min: -3, service_samples: 9 })).toBe(MINUTES_PAR_ARRET);
  });
  it("serviceConnu / libelleDuree", () => {
    expect(serviceConnu({ service_avg_min: 5, service_samples: 3 })).toBe(5);
    expect(serviceConnu({ service_avg_min: 5, service_samples: 1 })).toBeNull();
    expect(serviceConnu(null)).toBeNull();
    expect(libelleDuree({ service_avg_min: 4.4, service_samples: 3 })).toBe("≈ 4 min d'arrêt");
    expect(libelleDuree({ service_avg_min: 4.4, service_samples: 1 })).toBeNull();
  });
});

describe("fusionnerObservation : upsert sans perte", () => {
  it("première visite : la fiche se remplit", () => {
    const f = fusionnerObservation(null, obs({ nom: "Pharmacie du Port", telephone: "05 56 12 34 56", destinataire: "Mme Roux", consignes: "Code portail 1234", lat: 45.1, lng: -1.1, dureeMin: 6, contactTelephone: true }));
    expect(f).toMatchObject({
      label: "Pharmacie du Port", phone: "05 56 12 34 56", recipient: "Mme Roux", access_notes: "Code portail 1234", lat: 45.1, lng: -1.1,
      service_avg_min: 6, service_samples: 1, delivered_count: 1, failed_count: 0, contact_phone_count: 1, contact_message_count: 0, last_delivery_at: "2026-10-20T08:00:00.000Z",
    });
    expect(f.success_by_hour).toEqual({ "10": { ok: 1, ko: 0 } });
  });

  it("une visite sans information ne vide rien (téléphone, contact, consignes, coordonnées, créneau)", () => {
    const avant = fusionnerObservation(null, obs({ nom: "Pharmacie", telephone: "05 56 12 34 56", destinataire: "Mme Roux", consignes: "Code 1234", lat: 45, lng: -1, fenetre: { debut: "08:00:00", fin: "10:00:00" } }));
    const apres = fusionnerObservation(avant as unknown as Record<string, unknown>, obs({ nom: "", telephone: "", destinataire: null, consignes: "  ", lat: null, lng: null, fenetre: { debut: null, fin: null } }));
    expect(apres).toMatchObject({ label: "Pharmacie", phone: "05 56 12 34 56", recipient: "Mme Roux", access_notes: "Code 1234", lat: 45, lng: -1, window_start: "08:00:00", window_end: "10:00:00" });
    expect(apres.delivered_count).toBe(2);
  });

  it("la dernière valeur non vide gagne", () => {
    const avant = fusionnerObservation(null, obs({ telephone: "05 56 12 34 56", consignes: "Code 1234", fenetre: { debut: "08:00", fin: "10:00" } }));
    const apres = fusionnerObservation(avant as unknown as Record<string, unknown>, obs({ telephone: "05 56 99 99 99", consignes: "Code 9876", fenetre: { debut: null, fin: "12:00:00" } }));
    expect(apres.phone).toBe("05 56 99 99 99");
    expect(apres.access_notes).toBe("Code 9876");
    // Le créneau est remplacé en entier par le dernier créneau non vide (pas de mélange début ancien / fin nouvelle).
    expect(apres.window_start).toBeNull();
    expect(apres.window_end).toBe("12:00:00");
  });

  it("une heure illisible n'efface pas le créneau connu", () => {
    const avant = fusionnerObservation(null, obs({ fenetre: { debut: "08:00", fin: "10:00" } }));
    const apres = fusionnerObservation(avant as unknown as Record<string, unknown>, obs({ fenetre: { debut: "n'importe quoi", fin: "" } }));
    expect(apres.window_start).toBe("08:00");
    expect(apres.window_end).toBe("10:00");
  });

  it("un échec compte le passage et le motif, sans toucher à la durée ni aux consignes", () => {
    const avant = fusionnerObservation(null, obs({ consignes: "Code 1234", dureeMin: 5 }));
    const apres = fusionnerObservation(avant as unknown as Record<string, unknown>, obs({ statut: "failed", motif: "absent", heure: 14, consignes: "ignoré", dureeMin: 25, contactMessage: true }));
    expect(apres.failed_count).toBe(1);
    expect(apres.delivered_count).toBe(1);
    expect(apres.failure_reasons).toEqual({ absent: 1 });
    expect(apres.success_by_hour).toEqual({ "10": { ok: 1, ko: 0 }, "14": { ok: 0, ko: 1 } });
    expect(apres.service_avg_min).toBe(5);
    expect(apres.service_samples).toBe(1);
    expect(apres.contact_message_count).toBe(1);
    expect(apres.last_delivery_at).toBe("2026-10-20T08:00:00.000Z");
  });

  it("motif inconnu ou absent : « autre »", () => {
    expect(fusionnerObservation(null, obs({ statut: "failed", motif: "inventé" })).failure_reasons).toEqual({ autre: 1 });
    expect(fusionnerObservation(null, obs({ statut: "failed" })).failure_reasons).toEqual({ autre: 1 });
  });

  it("la durée suit la moyenne glissante", () => {
    let f = fusionnerObservation(null, obs({ dureeMin: 4 }));
    f = fusionnerObservation(f as unknown as Record<string, unknown>, obs({ dureeMin: 6 }));
    expect(f.service_avg_min).toBe(5);
    expect(f.service_samples).toBe(2);
    f = fusionnerObservation(f as unknown as Record<string, unknown>, obs({ dureeMin: null }));
    expect(f.service_avg_min).toBe(5);
    expect(f.service_samples).toBe(2);
    f = fusionnerObservation(f as unknown as Record<string, unknown>, obs({ dureeMin: 0 }));
    expect(f.service_samples).toBe(2);
  });

  it("les compteurs sont plafonnés", () => {
    const plein = { delivered_count: COMPTEUR_MAX, success_by_hour: { "10": { ok: COMPTEUR_MAX, ko: 0 } } };
    const f = fusionnerObservation(plein, obs());
    expect(f.delivered_count).toBe(COMPTEUR_MAX);
    expect(f.success_by_hour["10"]!.ok).toBe(COMPTEUR_MAX);
  });

  it("ne modifie pas la fiche reçue (fonction pure)", () => {
    const avant = { phone: "05", success_by_hour: { "10": { ok: 1, ko: 0 } }, failure_reasons: { absent: 1 } };
    const copie = JSON.parse(JSON.stringify(avant));
    fusionnerObservation(avant, obs({ statut: "failed", motif: "absent" }));
    expect(avant).toEqual(copie);
  });

  it("l'heure est bornée entre 0 et 23", () => {
    expect(Object.keys(fusionnerObservation(null, obs({ heure: 31 })).success_by_hour)).toEqual(["23"]);
    expect(Object.keys(fusionnerObservation(null, obs({ heure: -2 })).success_by_hour)).toEqual(["0"]);
  });

  it("tolère une fiche stockée abîmée", () => {
    const f = fusionnerObservation({ success_by_hour: "n'importe quoi", failure_reasons: [1, 2], delivered_count: "x", service_avg_min: -5 }, obs());
    expect(f.delivered_count).toBe(1);
    expect(f.success_by_hour).toEqual({ "10": { ok: 1, ko: 0 } });
  });
});

describe("lecture de données stockées", () => {
  it("lireReussites : heures valides et compteurs positifs seulement", () => {
    expect(lireReussites({ "10": { ok: 3, ko: 1 }, "24": { ok: 1, ko: 0 }, x: { ok: 1 }, "9": { ok: 0, ko: 0 }, "8": { ok: -2, ko: 2 } })).toEqual({ "10": { ok: 3, ko: 1 }, "8": { ok: 0, ko: 2 } });
    expect(lireReussites(null)).toEqual({});
    expect(lireReussites([])).toEqual({});
  });
  it("lireMotifs : motifs connus seulement", () => {
    expect(lireMotifs({ absent: 3, farfelu: 9, ferme: 0 })).toEqual({ absent: 3 });
  });
  it("lireDonnees : fiche vide ou nulle", () => {
    expect(lireDonnees(null)).toMatchObject({ phone: null, service_avg_min: null, service_samples: 0, delivered_count: 0, success_by_hour: {} });
  });
  it("lireDonnees : coordonnées numériques de Postgres (chaînes)", () => {
    expect(lireDonnees({ lat: "45.123456", lng: "-1.5", service_avg_min: "4.5" })).toMatchObject({ lat: 45.123456, lng: -1.5, service_avg_min: 4.5 });
  });
});

describe("creneauReussite : l'heure où la livraison réussit le plus souvent", () => {
  it("retient l'heure avec le meilleur taux sur assez de passages", () => {
    const f = { success_by_hour: { "9": { ok: 1, ko: 3 }, "10": { ok: 4, ko: 1 }, "14": { ok: 3, ko: 0 } } };
    expect(creneauReussite(f)).toEqual({ debut: "14:00", fin: "15:00", taux: 1, passages: 3 });
  });
  it("à taux égal, l'heure avec le plus de réussites", () => {
    expect(creneauReussite({ success_by_hour: { "10": { ok: 6, ko: 0 }, "14": { ok: 3, ko: 0 } } })?.debut).toBe("10:00");
  });
  it("pas de créneau avec trop peu de passages ou un taux insuffisant", () => {
    expect(creneauReussite({ success_by_hour: { "10": { ok: 2, ko: 0 } } })).toBeNull();
    expect(creneauReussite({ success_by_hour: { "10": { ok: 2, ko: 2 } } })).toBeNull();
    expect(creneauReussite({})).toBeNull();
    expect(creneauReussite(null)).toBeNull();
  });
  it("creneauConseille respecte les horaires d'ouverture", () => {
    const f = { success_by_hour: { "12": { ok: 4, ko: 0 } } };
    expect(creneauConseille(f)?.debut).toBe("12:00");
    expect(creneauConseille(f, (m) => m >= 14 * 60)).toBeNull();
    expect(creneauConseille(f, (m) => m >= 8 * 60 && m < 18 * 60)?.debut).toBe("12:00");
  });
});

describe("echecFrequent : alerte « échec fréquent ici »", () => {
  it("au moins 2 échecs ET 40 % des passages", () => {
    expect(echecFrequent({ delivered_count: 3, failed_count: 2, failure_reasons: { absent: 2 } })).toMatchObject({ echecs: 2, passages: 5, motif: "absent", libelle: "Échec fréquent ici : 2 sur 5 (client absent)" });
  });
  it("un seul échec, ou trop rare : pas d'alerte", () => {
    expect(echecFrequent({ delivered_count: 0, failed_count: 1 })).toBeNull();
    expect(echecFrequent({ delivered_count: 10, failed_count: 2 })).toBeNull();
    expect(echecFrequent(null)).toBeNull();
    expect(echecFrequent({})).toBeNull();
  });
  it("le motif le plus fréquent est cité ; sans motif connu, le libellé reste correct", () => {
    expect(echecFrequent({ delivered_count: 1, failed_count: 4, failure_reasons: { absent: 1, ferme: 3 } })?.libelle).toBe("Échec fréquent ici : 4 sur 5 (fermé)");
    expect(echecFrequent({ delivered_count: 0, failed_count: 3 })?.libelle).toBe("Échec fréquent ici : 3 sur 3");
  });
});

describe("consignesDepuisNotes : seules les consignes durables sont retenues", () => {
  it("retire les mentions d'échec, de lieu de remise, de message et de réserve", () => {
    expect(consignesDepuisNotes("Code portail 1234 · Client absent : sonner chez la voisine · Chez un voisin : Mme Roux · M — Message laissé / avis de passage · Réserve : colis abîmé")).toBe("Code portail 1234");
  });
  it("garde plusieurs consignes", () => {
    expect(consignesDepuisNotes("Quai arrière · Sonner deux fois")).toBe("Quai arrière · Sonner deux fois");
  });
  it("rien de durable : null", () => {
    expect(consignesDepuisNotes("Client absent : rien")).toBeNull();
    expect(consignesDepuisNotes("")).toBeNull();
    expect(consignesDepuisNotes(null)).toBeNull();
  });
});

describe("retenirAdresse : minimisation", () => {
  it("un établissement ou une adresse déjà dans l'annuaire, jamais un particulier", () => {
    expect(retenirAdresse({ business_name: "Boulangerie Martin" }, false)).toBe(true);
    expect(retenirAdresse({ business_name: null, kind: "point_relais" }, false)).toBe(true);
    expect(retenirAdresse({ business_name: null }, true)).toBe(true);
    expect(retenirAdresse({ business_name: null }, false)).toBe(false);
    expect(retenirAdresse({ business_name: "   " }, false)).toBe(false);
  });
});

describe("prerempli : reprend sans écraser", () => {
  const fiche = { label: "Pharmacie du Port", phone: "05 56 12 34 56", recipient: "Mme Roux", access_notes: "Code 1234", window_start: "08:00:00", window_end: "10:00:00" };
  it("remplit ce qui est vide", () => {
    expect(prerempli(fiche, {})).toEqual({ phone: "05 56 12 34 56", recipient: "Mme Roux", notes: "Code 1234", business_name: "Pharmacie du Port", window_start: "08:00:00", window_end: "10:00:00" });
  });
  it("ne remplace jamais une saisie", () => {
    const r = prerempli(fiche, { phone: "06 00 00 00 00", recipient: "M. Durand", notes: "Sonner", business_name: "Autre nom", window_end: "12:00" });
    expect(r).toEqual({ phone: null, recipient: null, notes: null, business_name: null, window_start: null, window_end: null });
  });
  it("sans fiche : rien", () => {
    expect(prerempli(null, {})).toEqual({ phone: null, recipient: null, notes: null, business_name: null, window_start: null, window_end: null });
  });
  it("un créneau saisi prime sur celui de la fiche", () => {
    expect(prerempli(fiche, { window_start: "09:00" })).toMatchObject({ window_start: null, window_end: null });
  });
});

describe("suggestions de l'annuaire", () => {
  it("résumé et détail", () => {
    const r = resumeFiche({ phone: "05 56 12 34 56", service_avg_min: 4.4, service_samples: 3, delivered_count: 1, failed_count: 3, failure_reasons: { absent: 3 }, success_by_hour: { "10": { ok: 3, ko: 0 } } });
    expect(r.telephone).toBe("05 56 12 34 56");
    expect(r.duree).toBe("≈ 4 min d'arrêt");
    expect(r.echec).toBe("Échec fréquent ici : 3 sur 4 (client absent)");
    expect(r.creneau).toBe("Livraison réussie surtout vers 10 h–11 h");
    expect(detailSuggestion(r)).toBe("Déjà livré par votre équipe · 05 56 12 34 56 · ≈ 4 min d'arrêt");
  });
  it("fiche vide : seulement « Déjà livré par votre équipe »", () => {
    expect(detailSuggestion(resumeFiche({}))).toBe("Déjà livré par votre équipe");
  });
});
