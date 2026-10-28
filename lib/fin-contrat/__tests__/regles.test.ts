import { describe, expect, it } from "vitest";
import {
  ACTIONS_AUDIT_CONSERVEES,
  ELEMENTS_CONSERVES,
  JOURS_AVANT_PREAVIS,
  JOURS_AVANT_SUPPRESSION,
  JOURS_PREAVIS_MINIMUM,
  SUPPRESSIONS_MAX_PAR_PASSAGE,
  abonnementVivant,
  champsFinContratStripe,
  dateFinContrat,
  dateSuppressionPrevue,
  decider,
  ligneJournal,
  planifier,
  preavisEnvoye,
  purgeActive,
  type OrganisationFinContrat,
} from "@/lib/fin-contrat/regles";

const JOUR = 86_400_000;
const fin = new Date("2026-06-01T00:00:00Z");
const apres = (jours: number, depuis: Date = fin) => new Date(depuis.getTime() + jours * JOUR);

function org(extra: Partial<OrganisationFinContrat> = {}): OrganisationFinContrat {
  return {
    id: "o1",
    name: "Transports Dupont",
    is_demo: false,
    subscription_status: "canceled",
    stripe_subscription_id: "sub_1",
    offre: null,
    trial_ends_at: null,
    contrat_termine_le: fin.toISOString(),
    suppression_preavis_envoye_le: null,
    suppression_bloquee: false,
    suppression_bloquee_motif: null,
    ...extra,
  };
}

describe("constantes", () => {
  it("60 jours avant le préavis, 90 jours avant la suppression, 30 jours de préavis minimum", () => {
    expect(JOURS_AVANT_PREAVIS).toBe(60);
    expect(JOURS_AVANT_SUPPRESSION).toBe(90);
    expect(JOURS_PREAVIS_MINIMUM).toBe(30);
    expect(JOURS_AVANT_SUPPRESSION - JOURS_AVANT_PREAVIS).toBe(JOURS_PREAVIS_MINIMUM);
  });
});

describe("purgeActive : DRY-RUN par défaut", () => {
  it("seule la valeur « true » active la suppression réelle", () => {
    expect(purgeActive({})).toBe(false);
    expect(purgeActive({ FIN_CONTRAT_PURGE_ACTIVE: "" })).toBe(false);
    expect(purgeActive({ FIN_CONTRAT_PURGE_ACTIVE: "false" })).toBe(false);
    expect(purgeActive({ FIN_CONTRAT_PURGE_ACTIVE: "1" })).toBe(false);
    expect(purgeActive({ FIN_CONTRAT_PURGE_ACTIVE: "yes" })).toBe(false);
    expect(purgeActive({ FIN_CONTRAT_PURGE_ACTIVE: "TRUE" })).toBe(false);
    expect(purgeActive({ FIN_CONTRAT_PURGE_ACTIVE: "true" })).toBe(true);
    expect(purgeActive({ FIN_CONTRAT_PURGE_ACTIVE: " true " })).toBe(true);
  });
});

describe("dateFinContrat : comment la fin de contrat est représentée", () => {
  it("abonnement Stripe annulé : la date posée par le webhook", () => {
    expect(dateFinContrat(org())?.toISOString()).toBe(fin.toISOString());
  });

  it("abonnement annulé sans date connue : null (jamais de suppression sans date)", () => {
    expect(dateFinContrat(org({ contrat_termine_le: null }))).toBeNull();
  });

  it("abonnement vivant : null, même avec une date périmée", () => {
    for (const subscription_status of ["active", "past_due", "trialing", "incomplete"]) {
      expect(dateFinContrat(org({ subscription_status })), subscription_status).toBeNull();
      expect(abonnementVivant(org({ subscription_status }))).toBe(true);
    }
  });

  it("client facturé hors Stripe : la date posée par GODAC compte", () => {
    const o = org({ stripe_subscription_id: null, subscription_status: "trialing", contrat_termine_le: "2026-05-01T00:00:00Z" });
    expect(dateFinContrat(o)?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("client sans Stripe ni date : jamais traité (pilote facturé à la main)", () => {
    expect(dateFinContrat(org({ stripe_subscription_id: null, subscription_status: "trialing", contrat_termine_le: null }))).toBeNull();
    expect(decider(org({ stripe_subscription_id: null, subscription_status: "trialing", contrat_termine_le: null }), apres(500)).action).toBe("aucune");
  });

  it("essai GO Navigation sans abonnement : la fin de l'essai", () => {
    const essai = org({ offre: "go_navigation", stripe_subscription_id: null, subscription_status: "trialing", contrat_termine_le: null, trial_ends_at: "2026-07-01T00:00:00Z" });
    expect(dateFinContrat(essai)?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("essai GO Navigation devenu client payant : pas de suppression", () => {
    const paye = org({ offre: "go_navigation", stripe_subscription_id: "sub_9", subscription_status: "active", contrat_termine_le: null, trial_ends_at: "2026-07-01T00:00:00Z" });
    expect(dateFinContrat(paye)).toBeNull();
  });

  it("organisation de démonstration : jamais", () => {
    expect(dateFinContrat(org({ is_demo: true }))).toBeNull();
    expect(decider(org({ is_demo: true }), apres(1000)).action).toBe("aucune");
  });

  it("date invalide : ignorée", () => {
    expect(dateFinContrat(org({ contrat_termine_le: "n'importe quoi" }))).toBeNull();
  });
});

describe("decider : calendrier fin + 60 j (préavis) et fin + 90 j (suppression)", () => {
  it("fin de contrat à venir : rien", () => {
    expect(decider(org(), apres(-1)).action).toBe("aucune");
  });

  it("avant 60 jours : attente du préavis", () => {
    const d = decider(org(), apres(59));
    expect(d.action).toBe("attente");
    if (d.action === "attente") expect(d.date.toISOString()).toBe(apres(60).toISOString());
  });

  it("à 60 jours : préavis dû, suppression prévue à fin + 90 jours", () => {
    const d = decider(org(), apres(60));
    expect(d.action).toBe("preavis");
    if (d.action === "preavis") expect(d.suppressionPrevue.toISOString()).toBe(apres(90).toISOString());
  });

  it("préavis tardif (cron en panne) : la suppression est repoussée à 30 jours après le préavis, jamais plus tôt", () => {
    const d = decider(org(), apres(80));
    expect(d.action).toBe("preavis");
    if (d.action === "preavis") expect(d.suppressionPrevue.toISOString()).toBe(apres(110).toISOString());
  });

  it("préavis envoyé : attente jusqu'à la date de suppression", () => {
    const o = org({ suppression_preavis_envoye_le: apres(60).toISOString() });
    expect(decider(o, apres(89)).action).toBe("attente");
    const d = decider(o, apres(89));
    if (d.action === "attente") expect(d.date.toISOString()).toBe(apres(90).toISOString());
  });

  it("préavis envoyé à 60 jours : suppression à 90 jours", () => {
    const o = org({ suppression_preavis_envoye_le: apres(60).toISOString() });
    expect(decider(o, apres(90)).action).toBe("suppression");
    expect(decider(o, apres(200)).action).toBe("suppression");
  });

  it("préavis envoyé tard : suppression au plus tôt 30 jours après le préavis, même au-delà de 90 jours", () => {
    const o = org({ suppression_preavis_envoye_le: apres(95).toISOString() });
    expect(decider(o, apres(124)).action).toBe("attente");
    expect(decider(o, apres(125)).action).toBe("suppression");
  });

  it("jamais de suppression sans préavis, même à 1000 jours", () => {
    expect(decider(org(), apres(1000)).action).toBe("preavis");
  });

  it("un préavis antérieur à la fin du contrat (ancien contrat) ne compte pas", () => {
    const o = org({ suppression_preavis_envoye_le: apres(-200).toISOString() });
    expect(preavisEnvoye(o, fin)).toBeNull();
    expect(decider(o, apres(120)).action).toBe("preavis");
  });

  it("dateSuppressionPrevue : maximum de fin + 90 j et préavis + 30 j", () => {
    expect(dateSuppressionPrevue(fin, apres(60), apres(60)).toISOString()).toBe(apres(90).toISOString());
    expect(dateSuppressionPrevue(fin, apres(100), apres(100)).toISOString()).toBe(apres(130).toISOString());
    expect(dateSuppressionPrevue(fin, null, apres(70)).toISOString()).toBe(apres(100).toISOString());
  });
});

describe("blocage en cas de litige", () => {
  it("bloquée : ni préavis ni suppression, à n'importe quelle date", () => {
    const motif = "Litige sur la facture de mai";
    for (const jours of [10, 60, 90, 400]) {
      const d = decider(org({ suppression_bloquee: true, suppression_bloquee_motif: motif }), apres(jours));
      expect(d.action, `J+${jours}`).toBe(jours < 0 ? "aucune" : "bloquee");
      expect(d.raison).toContain(motif);
    }
    const avecPreavis = org({ suppression_bloquee: true, suppression_preavis_envoye_le: apres(60).toISOString() });
    expect(decider(avecPreavis, apres(300)).action).toBe("bloquee");
  });

  it("le déblocage reprend le calendrier là où il en est", () => {
    const o = org({ suppression_bloquee: false, suppression_preavis_envoye_le: apres(60).toISOString() });
    expect(decider(o, apres(300)).action).toBe("suppression");
  });
});

describe("planifier : DRY-RUN et plafond", () => {
  const eligible = (id: string) => org({ id, name: id, suppression_preavis_envoye_le: apres(60).toISOString() });

  it("en DRY-RUN rien n'est exécuté, mais les décisions sont calculées", () => {
    const plan = planifier([eligible("a"), org({ id: "b" })], apres(100), false);
    expect(plan.map((p) => p.decision.action)).toEqual(["suppression", "preavis"]);
    expect(plan.every((p) => p.executer === false)).toBe(true);
  });

  it("en mode actif, préavis et suppression sont exécutés, pas les autres décisions", () => {
    const plan = planifier([eligible("a"), org({ id: "b" }), org({ id: "c", suppression_bloquee: true }), org({ id: "d", subscription_status: "active" })], apres(100), true);
    expect(plan.map((p) => [p.organisationId, p.decision.action, p.executer])).toEqual([
      ["a", "suppression", true],
      ["b", "preavis", true],
      ["c", "bloquee", false],
      ["d", "aucune", false],
    ]);
  });

  it(`au plus ${SUPPRESSIONS_MAX_PAR_PASSAGE} suppressions par passage, les suivantes sont reportées`, () => {
    const orgs = ["a", "b", "c", "d", "e"].map(eligible);
    const plan = planifier(orgs, apres(100), true);
    expect(plan.filter((p) => p.executer).length).toBe(SUPPRESSIONS_MAX_PAR_PASSAGE);
    expect(plan.filter((p) => p.reportee).map((p) => p.organisationId)).toEqual(["d", "e"]);
  });

  it("le plafond ne limite pas les préavis", () => {
    const orgs = ["a", "b", "c", "d", "e"].map((id) => org({ id }));
    expect(planifier(orgs, apres(61), true).filter((p) => p.executer).length).toBe(5);
  });

  it("lignes de journal en DRY-RUN et en mode actif", () => {
    const [a] = planifier([eligible("a")], apres(100), false);
    expect(JSON.parse(ligneJournal(a!, false))).toMatchObject({ evenement: "fin_contrat", mode: "dry-run", resultat: "DRY_RUN_SUPPRESSION", organisation: "a" });
    const [b] = planifier([eligible("a")], apres(100), true);
    expect(JSON.parse(ligneJournal(b!, true))).toMatchObject({ mode: "actif", resultat: "SUPPRESSION" });
    const [c] = planifier([org({ id: "c", suppression_bloquee: true, suppression_bloquee_motif: "litige" })], apres(100), true);
    expect(JSON.parse(ligneJournal(c!, true)).resultat).toBe("BLOQUEE");
    const [d] = planifier([org({ id: "d" })], apres(100), false);
    expect(JSON.parse(ligneJournal(d!, false))).toMatchObject({ resultat: "DRY_RUN_PREAVIS", date: apres(130).toISOString().slice(0, 10) });
  });
});

describe("conservation du strict nécessaire", () => {
  it("les preuves d'acceptation et de consentement, et les traces du préavis, sont copiées avant la suppression", () => {
    for (const a of ["inscription_go_navigation", "accord_usage_essai", "accuse_parametres_indicatifs", "fin_contrat_preavis", "fin_contrat_suppression_bloquee"]) {
      expect(ACTIONS_AUDIT_CONSERVEES as readonly string[]).toContain(a);
    }
  });

  it("aucune donnée métier dans ce qui est conservé", () => {
    const texte = ACTIONS_AUDIT_CONSERVEES.join(" ");
    expect(texte).not.toMatch(/paie|pointage|tournee|plein|ticpe|amende|arret/);
    expect(ELEMENTS_CONSERVES.map((e) => e.element).join(" ")).not.toMatch(/salari|pointage|tournée|bulletin/i);
    expect(ELEMENTS_CONSERVES.length).toBe(3);
  });
});

describe("webhook Stripe : fin de contrat", () => {
  const maintenant = new Date("2026-10-28T10:00:00Z");

  it("abonnement annulé : ended_at, sinon canceled_at, sinon maintenant", () => {
    const t = Math.floor(new Date("2026-09-30T00:00:00Z").getTime() / 1000);
    expect(champsFinContratStripe({ status: "canceled", ended_at: t, canceled_at: t - 86400 }, maintenant)).toEqual({ action: "terminer", contrat_termine_le: "2026-09-30T00:00:00.000Z" });
    expect(champsFinContratStripe({ status: "canceled", ended_at: null, canceled_at: t - 86400 }, maintenant)).toEqual({ action: "terminer", contrat_termine_le: "2026-09-29T00:00:00.000Z" });
    expect(champsFinContratStripe({ status: "canceled" }, maintenant)).toEqual({ action: "terminer", contrat_termine_le: maintenant.toISOString() });
  });

  it("abonnement redevenu vivant : on efface la date et le préavis", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid"]) expect(champsFinContratStripe({ status }, maintenant)).toEqual({ action: "reactiver" });
  });

  it("pause ou expiration à la création : ce n'est pas une fin de contrat", () => {
    expect(champsFinContratStripe({ status: "paused" }, maintenant)).toEqual({ action: "rien" });
    expect(champsFinContratStripe({ status: "incomplete_expired" }, maintenant)).toEqual({ action: "rien" });
  });
});
