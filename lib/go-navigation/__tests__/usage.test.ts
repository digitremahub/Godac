import { describe, expect, it } from "vitest";
import {
  calculerLignes,
  chronologie,
  detaillerTournees,
  libelleDuree,
  libelleEssai,
  libelleEvenement,
  libellePourcentage,
  pourcentage,
  synthetiser,
  type ArretBrut,
  type OrgEssai,
  type TourneeBrute,
  type UsageBrut,
} from "@/lib/go-navigation/usage";
import { ACCORD_USAGE_TEXTE, ACCORD_USAGE_VERSION, formulaireInscriptionSchema, preuveAccordUsage } from "@/lib/go-navigation/offre";

const MAINTENANT = new Date("2026-11-10T10:00:00Z");

const org = (id: string, extra: Partial<OrgEssai> = {}): OrgEssai => ({
  id,
  name: `GO Navigation – Essai ${id}`,
  created_at: "2026-11-01T08:00:00Z",
  trial_ends_at: "2026-12-01T08:00:00Z",
  subscription_status: "trialing",
  apporteur: null,
  derniereConnexionAuth: null,
  accordDetail: false,
  ...extra,
});
const tournee = (id: string, organization_id: string, extra: Partial<TourneeBrute> = {}): TourneeBrute => ({
  id,
  organization_id,
  run_date: "2026-11-05",
  status: "loading",
  created_at: "2026-11-05T06:00:00Z",
  started_at: null,
  optimized_at: null,
  ...extra,
});
const arret = (organization_id: string, run_id: string, status: string, extra: Partial<ArretBrut> = {}): ArretBrut => ({
  organization_id,
  run_id,
  status,
  created_at: "2026-11-05T06:10:00Z",
  done_at: null,
  ...extra,
});
const usage = (organization_id: string, feature: string, units = 1, created_at = "2026-11-05T06:20:00Z"): UsageBrut => ({ organization_id, feature, units, created_at });

describe("indicateurs par organisation d'essai", () => {
  const orgs = [org("a", { apporteur: "Marie Martin (Transports Exemple)", derniereConnexionAuth: "2026-11-08T09:00:00Z" }), org("b"), org("c", { trial_ends_at: "2026-11-02T00:00:00Z" })];
  const lignes = calculerLignes(
    orgs,
    {
      tournees: [
        tournee("t1", "a", { status: "done", started_at: "2026-11-05T07:00:00Z", optimized_at: "2026-11-05T06:30:00Z" }),
        tournee("t2", "a"),
        tournee("t3", "b", { status: "in_progress", started_at: "2026-11-06T07:00:00Z" }),
      ],
      arrets: [
        arret("a", "t1", "delivered", { created_at: "2026-11-05T06:10:00Z", done_at: "2026-11-05T08:00:00Z" }),
        arret("a", "t1", "failed", { created_at: "2026-11-05T09:00:00Z", done_at: "2026-11-05T09:30:00Z" }),
        arret("a", "t1", "pending"),
        arret("a", "t2", "pending", { created_at: "2026-11-05T09:00:00Z" }),
        arret("b", "t3", "delivered", { created_at: "2026-11-06T07:00:00Z", done_at: "2026-11-09T12:00:00Z" }),
      ],
      usages: [usage("a", "ocr_label", 3), usage("a", "route_optimization"), usage("a", "ocr_label", 2), usage("b", "route_optimization", 1, "2026-11-09T18:00:00Z")],
      recommandations: new Map([["a", 1]]),
    },
    MAINTENANT,
  );
  const a = lignes.find((l) => l.id === "a")!;
  const b = lignes.find((l) => l.id === "b")!;
  const c = lignes.find((l) => l.id === "c")!;

  it("compte tournées créées, démarrées, clôturées", () => {
    expect([a.tourneesCreees, a.tourneesDemarrees, a.tourneesCloturees]).toEqual([2, 1, 1]);
    expect([b.tourneesCreees, b.tourneesDemarrees, b.tourneesCloturees]).toEqual([1, 1, 0]);
  });

  it("compte arrêts, livrés, échecs et adresses ajoutées après le démarrage", () => {
    expect([a.arrets, a.arretsLivres, a.arretsEchec]).toEqual([4, 1, 1]);
    // t1 démarrée à 07:00 : l'arrêt créé à 09:00 est ajouté en tournée ; t2 non démarrée : aucun.
    expect(a.arretsAjoutesEnTournee).toBe(1);
    expect(b.arretsAjoutesEnTournee).toBe(0);
  });

  it("somme les unités de lectures d'étiquettes et compte les optimisations", () => {
    expect(a.lecturesEtiquettes).toBe(5);
    expect(a.optimisations).toBe(1);
    expect(b.optimisations).toBe(1);
    expect(a.recommandations).toBe(1);
    expect(b.recommandations).toBe(0);
  });

  it("dernière activité : la plus récente entre connexion, tournées, arrêts et usage", () => {
    expect(a.derniereActivite).toBe("2026-11-08T09:00:00Z");
    expect(b.derniereActivite).toBe("2026-11-09T18:00:00Z");
    expect(c.derniereActivite).toBeNull();
  });

  it("jours restants, essai terminé, utilisé ou non", () => {
    expect(a.joursRestants).toBe(21);
    expect(a.essaiTermine).toBe(false);
    expect(c.essaiTermine).toBe(true);
    expect(c.utilise).toBe(false);
    expect(a.utilise).toBe(true);
    expect(a.apporteur).toBe("Marie Martin (Transports Exemple)");
  });

  it("un abonné actif n'est jamais « essai terminé »", () => {
    const x = calculerLignes([org("x", { trial_ends_at: "2026-11-02T00:00:00Z", subscription_status: "active" })], { tournees: [], arrets: [], usages: [], recommandations: new Map() }, MAINTENANT)[0]!;
    expect(x.essaiTermine).toBe(false);
    expect(libelleEssai(x)).toBe("Abonné");
  });

  it("synthèse : totaux, taux et entonnoir", () => {
    const s = synthetiser(lignes);
    expect(s.inscrits).toBe(3);
    expect(s.actifs).toBe(2);
    expect(s.utilises).toBe(2);
    expect(s.tauxTourneesDemarrees).toBe(67); // 2 démarrées / 3 créées
    expect(s.tauxLivraison).toBe(67); // 2 livrés / (2 livrés + 1 échec)
    expect(s.tourneesDemarreesParEssaiUtilise).toBe(1);
    expect(s.entonnoir.map((e) => [e.cle, e.nombre, e.pourcentage])).toEqual([
      ["inscrits", 3, 100],
      ["tournee_creee", 2, 67],
      ["tournee_demarree", 2, 67],
      ["a_livre", 2, 67],
      ["a_recommande", 1, 33],
    ]);
  });

  it("synthèse sans inscrit : aucun pourcentage inventé", () => {
    const s = synthetiser([]);
    expect(s.tauxTourneesDemarrees).toBeNull();
    expect(s.tauxLivraison).toBeNull();
    expect(s.tourneesDemarreesParEssaiUtilise).toBeNull();
    expect(s.entonnoir.every((e) => e.pourcentage === null)).toBe(true);
  });
});

describe("libellés", () => {
  it("jours restants au singulier et au pluriel, essai terminé", () => {
    expect(libelleEssai({ joursRestants: 12, essaiTermine: false, abonne: false })).toBe("12 jours restants");
    expect(libelleEssai({ joursRestants: 1, essaiTermine: false, abonne: false })).toBe("1 jour restant");
    expect(libelleEssai({ joursRestants: 0, essaiTermine: true, abonne: false })).toBe("Essai terminé");
  });

  it("pourcentage et durée", () => {
    expect(pourcentage(1, 3)).toBe(33);
    expect(pourcentage(1, 0)).toBeNull();
    expect(libellePourcentage(null)).toBe("—");
    expect(libellePourcentage(50)).toBe("50 %");
    expect(libelleDuree(null)).toBe("—");
    expect(libelleDuree(45)).toBe("45 min");
    expect(libelleDuree(125)).toBe("2 h 05");
  });

  it("événements : libellé connu, repli neutre sans exposer le type brut ni de contenu", () => {
    expect(libelleEvenement("arret", "delivered")).toBe("Arrêt livré");
    expect(libelleEvenement("fonction", "ocr_label")).toBe("Lecture d'étiquette");
    expect(libelleEvenement("arret", "nouveau_type")).toBe("Autre événement");
  });
});

describe("détail d'un compte (avec accord)", () => {
  const tournees = [
    tournee("t1", "a", { run_date: "2026-11-04", status: "done", started_at: "2026-11-04T07:00:00Z", optimized_at: "2026-11-04T06:30:00Z" }),
    tournee("t2", "a", { run_date: "2026-11-06", status: "in_progress", started_at: "2026-11-06T07:00:00Z" }),
  ];
  const lignes = detaillerTournees(tournees, [
    { run_id: "t1", status: "delivered", done_at: "2026-11-04T08:00:00Z" },
    { run_id: "t1", status: "failed", done_at: "2026-11-04T09:30:00Z" },
    { run_id: "t1", status: "pending", done_at: null },
  ]);

  it("tournées de la plus récente à la plus ancienne", () => {
    expect(lignes.map((l) => l.id)).toEqual(["t2", "t1"]);
  });

  it("compteurs, fin au dernier arrêt traité, durée, optimisation", () => {
    const t1 = lignes[1]!;
    expect([t1.arrets, t1.livres, t1.echecs]).toEqual([3, 1, 1]);
    expect(t1.fin).toBe("2026-11-04T09:30:00Z");
    expect(t1.dureeMinutes).toBe(150);
    expect(t1.optimisee).toBe(true);
    expect(lignes[0]!.dureeMinutes).toBeNull();
    expect(lignes[0]!.optimisee).toBe(false);
  });

  it("ne porte aucune donnée de destinataire ni de position", () => {
    const cles = Object.keys(lignes[1]!).join(",");
    expect(cles).not.toMatch(/adresse|address|recipient|phone|parcel|lat|lng|gps/i);
  });

  it("chronologie : type et horodatage seulement, récents d'abord, bornée", () => {
    const evts = chronologie(
      [
        { event_type: "delivered", created_at: "2026-11-05T08:00:00Z" },
        { event_type: "note", created_at: "2026-11-05T09:00:00Z" },
      ],
      [{ feature: "ocr_label", units: 3, created_at: "2026-11-05T08:30:00Z" }],
    );
    expect(evts.map((e) => e.libelle)).toEqual(["Note ajoutée", "Lecture d'étiquette (×3)", "Arrêt livré"]);
    expect(Object.keys(evts[0]!).sort()).toEqual(["at", "libelle"]);
    expect(chronologie(evts as never, [], 2)).toHaveLength(2);
  });
});

describe("accord facultatif de partage du détail d'usage", () => {
  const base = { jeton: "x".repeat(10), prenom: "Jean", nom: "Dupont", email: "jean@exemple.fr", motDePasse: "motdepasse-long", cgu: true as const };

  it("absent = faux : les anciens formulaires et liens déjà envoyés restent valides", () => {
    const r = formulaireInscriptionSchema.parse(base);
    expect(r.partageUsageDetail).toBe(false);
  });

  it("coché = vrai, décoché = faux, valeur invalide refusée", () => {
    expect(formulaireInscriptionSchema.parse({ ...base, partageUsageDetail: true }).partageUsageDetail).toBe(true);
    expect(formulaireInscriptionSchema.parse({ ...base, partageUsageDetail: false }).partageUsageDetail).toBe(false);
    expect(formulaireInscriptionSchema.safeParse({ ...base, partageUsageDetail: "oui" }).success).toBe(false);
  });

  it("texte versionné : fidèle à la formulation validée, preuve = version + texte", () => {
    expect(ACCORD_USAGE_TEXTE).toBe(
      "J'accepte que GODAC consulte le détail de mon usage de GO (tournées, étapes, horaires — sans les noms ni adresses de mes clients) pour améliorer l'application. Je peux retirer cet accord à tout moment.",
    );
    expect(ACCORD_USAGE_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
    expect(preuveAccordUsage()).toBe(`${ACCORD_USAGE_VERSION} | ${ACCORD_USAGE_TEXTE}`);
  });
});
