import { describe, expect, it } from "vitest";
import {
  actionsProposees,
  compterParStatut,
  corpsActionSchema,
  estSuspendue,
  filtrerComptes,
  joursEssaiRestants,
  normaliserMotif,
  normaliserTexte,
  offreCompte,
  statutCompte,
  textesConfirmation,
  trierComptes,
  verifierAction,
  type LigneCompte,
  type OrgAction,
} from "@/lib/comptes-essai/regles";

const MAINTENANT = new Date("2026-11-16T10:00:00Z");
const jours = (n: number) => new Date(MAINTENANT.getTime() + n * 24 * 3600 * 1000).toISOString();

const org = (extra: Partial<OrgAction> = {}): OrgAction => ({ id: "o1", name: "GO Navigation – Jean Dupont", offre: "go_navigation", subscription_status: "trialing", trial_ends_at: jours(10), suspendue_le: null, ...extra });

describe("estSuspendue", () => {
  it("vrai seulement avec une date valide", () => {
    expect(estSuspendue({ suspendue_le: "2026-11-01T00:00:00Z" })).toBe(true);
    expect(estSuspendue({ suspendue_le: new Date() })).toBe(true);
    expect(estSuspendue({ suspendue_le: null })).toBe(false);
    expect(estSuspendue({ suspendue_le: "" })).toBe(false);
    expect(estSuspendue({ suspendue_le: "pas une date" })).toBe(false);
    expect(estSuspendue({})).toBe(false);
    expect(estSuspendue(null)).toBe(false);
    expect(estSuspendue(undefined)).toBe(false);
  });
});

describe("normaliserMotif", () => {
  it("normalise les espaces, refuse moins de 5 caractères, plafonne à 500", () => {
    expect(normaliserMotif("  impayé \n  relance  ")).toBe("impayé relance");
    expect(normaliserMotif("abcd")).toBeNull();
    expect(normaliserMotif("    ab   ")).toBeNull();
    expect(normaliserMotif(undefined)).toBeNull();
    expect(normaliserMotif(42)).toBeNull();
    expect(normaliserMotif("x".repeat(900))).toHaveLength(500);
  });
});

describe("statutCompte", () => {
  it("la suspension passe avant tout (même abonné, même en essai)", () => {
    expect(statutCompte(org({ suspendue_le: jours(-1) }), MAINTENANT)).toBe("suspendu");
    expect(statutCompte(org({ suspendue_le: jours(-1), subscription_status: "active" }), MAINTENANT)).toBe("suspendu");
  });
  it("GO Navigation : essai en cours, terminé (date dépassée ou absente), abonné", () => {
    expect(statutCompte(org(), MAINTENANT)).toBe("essai_en_cours");
    expect(statutCompte(org({ trial_ends_at: jours(-1) }), MAINTENANT)).toBe("essai_termine");
    expect(statutCompte(org({ trial_ends_at: null }), MAINTENANT)).toBe("essai_termine");
    expect(statutCompte(org({ trial_ends_at: jours(-30), subscription_status: "active" }), MAINTENANT)).toBe("abonne");
  });
  it("même règle que lib/go-navigation/offre (fin pile maintenant = terminé)", () => {
    expect(statutCompte(org({ trial_ends_at: MAINTENANT.toISOString() }), MAINTENANT)).toBe("essai_termine");
  });
  it("autre offre : abonné, essai (avec ou sans date), essai dépassé, autres statuts", () => {
    const classique = (extra: Partial<OrgAction>) => org({ offre: null, trial_ends_at: null, ...extra });
    expect(statutCompte(classique({ subscription_status: "active" }), MAINTENANT)).toBe("abonne");
    expect(statutCompte(classique({ subscription_status: "trialing" }), MAINTENANT)).toBe("essai_en_cours");
    expect(statutCompte(classique({ subscription_status: "trialing", trial_ends_at: jours(3) }), MAINTENANT)).toBe("essai_en_cours");
    expect(statutCompte(classique({ subscription_status: "trialing", trial_ends_at: jours(-3) }), MAINTENANT)).toBe("essai_termine");
    for (const s of ["past_due", "canceled", "incomplete", null]) expect(statutCompte(classique({ subscription_status: s }), MAINTENANT)).toBe("autre");
  });
  it("offreCompte", () => {
    expect(offreCompte({ offre: "go_navigation" })).toBe("go_navigation");
    expect(offreCompte({ offre: null })).toBe("autre");
    expect(offreCompte({})).toBe("autre");
  });
});

describe("joursEssaiRestants", () => {
  it("arrondi au supérieur pendant l'essai ; null sinon", () => {
    expect(joursEssaiRestants(org({ trial_ends_at: jours(10) }), MAINTENANT)).toBe(10);
    expect(joursEssaiRestants(org({ trial_ends_at: new Date(MAINTENANT.getTime() + 3600_000).toISOString() }), MAINTENANT)).toBe(1);
    expect(joursEssaiRestants(org({ trial_ends_at: jours(-2) }), MAINTENANT)).toBeNull();
    expect(joursEssaiRestants(org({ subscription_status: "active" }), MAINTENANT)).toBeNull();
    expect(joursEssaiRestants(org({ suspendue_le: jours(-1) }), MAINTENANT)).toBeNull();
    expect(joursEssaiRestants(org({ offre: null, trial_ends_at: null }), MAINTENANT)).toBeNull();
  });
});

function ligne(extra: Partial<LigneCompte>): LigneCompte {
  return {
    id: "x",
    nom: "Alpha",
    plan: null,
    offre: "go_navigation",
    abonnement: "trialing",
    statut: "essai_en_cours",
    trialEndsAt: jours(10),
    joursRestants: 10,
    creeLe: jours(-5),
    apporteur: null,
    utilisateursActifs: 1,
    emailDirection: null,
    derniereActivite: null,
    sourceActivite: null,
    modules: [],
    tournees: 0,
    tourneesDemarrees: 0,
    arrets: 0,
    arretsLivres: 0,
    optimisations: 0,
    lecturesEtiquettes: 0,
    suspendueLe: null,
    suspendueMotif: null,
    suspenduePar: null,
    organisationDuStaff: false,
    ...extra,
  };
}

const LIGNES: LigneCompte[] = [
  ligne({ id: "a", nom: "Éric Transports", statut: "essai_en_cours", trialEndsAt: jours(20), creeLe: jours(-10), emailDirection: "eric@exemple.fr", derniereActivite: jours(-1), arrets: 50, tournees: 4 }),
  ligne({ id: "b", nom: "Bravo Logistique", statut: "essai_termine", trialEndsAt: jours(-2), creeLe: jours(-40), apporteur: "Marie Curie (Transports Curie)", derniereActivite: jours(-20), arrets: 5 }),
  ligne({ id: "c", nom: "charlie express", statut: "suspendu", creeLe: jours(-3), derniereActivite: null, suspendueLe: jours(-1) }),
  ligne({ id: "d", nom: "Delta SARL", offre: "autre", statut: "abonne", abonnement: "active", trialEndsAt: null, creeLe: jours(-200), derniereActivite: jours(-2), arrets: 900, tournees: 80 }),
  ligne({ id: "e", nom: "Écho Fret", statut: "essai_en_cours", trialEndsAt: jours(2), creeLe: jours(-28), derniereActivite: jours(-7), arrets: 10 }),
];

describe("filtres et recherche", () => {
  it("compte par statut (somme = total)", () => {
    const c = compterParStatut(LIGNES);
    expect(c).toMatchObject({ tous: 5, essai_en_cours: 2, essai_termine: 1, suspendu: 1, abonne: 1, autre: 0 });
  });
  it("filtre par statut", () => {
    expect(filtrerComptes(LIGNES, "essai_en_cours", "").map((l) => l.id)).toEqual(["a", "e"]);
    expect(filtrerComptes(LIGNES, "essai_termine", "").map((l) => l.id)).toEqual(["b"]);
    expect(filtrerComptes(LIGNES, "suspendu", "").map((l) => l.id)).toEqual(["c"]);
    expect(filtrerComptes(LIGNES, "tous", "")).toHaveLength(5);
  });
  it("recherche sans accent ni casse, sur nom / e-mail direction / apporteur, tous les mots", () => {
    expect(filtrerComptes(LIGNES, "tous", "eric").map((l) => l.id)).toEqual(["a"]);
    expect(filtrerComptes(LIGNES, "tous", "ÉCHO").map((l) => l.id)).toEqual(["e"]);
    expect(filtrerComptes(LIGNES, "tous", "exemple.fr").map((l) => l.id)).toEqual(["a"]);
    expect(filtrerComptes(LIGNES, "tous", "curie marie").map((l) => l.id)).toEqual(["b"]);
    expect(filtrerComptes(LIGNES, "tous", "curie zzz")).toEqual([]);
    expect(filtrerComptes(LIGNES, "essai_termine", "eric")).toEqual([]);
  });
  it("normaliserTexte", () => {
    expect(normaliserTexte("  Éric Â ")).toBe("eric a");
    expect(normaliserTexte(null)).toBe("");
  });
});

describe("tri", () => {
  const ids = (t: Parameters<typeof trierComptes>[1]) => trierComptes(LIGNES, t).map((l) => l.id);
  it("création : récents d'abord", () => expect(ids("creation_recent")).toEqual(["c", "a", "e", "b", "d"]));
  it("nom : alphabétique sans tenir compte des accents ni de la casse", () => expect(ids("nom")).toEqual(["b", "c", "d", "e", "a"]));
  it("fin d'essai : essais en cours par échéance, les autres ensuite", () => expect(ids("fin_essai").slice(0, 2)).toEqual(["e", "a"]));
  it("activité récente / ancienne : les comptes sans activité passent toujours en dernier", () => {
    expect(ids("activite_recente")).toEqual(["a", "d", "e", "b", "c"]);
    expect(ids("activite_ancienne")).toEqual(["b", "e", "d", "a", "c"]);
  });
  it("usage : arrêts décroissants", () => expect(ids("usage").slice(0, 3)).toEqual(["d", "a", "e"]));
  it("ne modifie pas le tableau d'origine", () => {
    const avant = LIGNES.map((l) => l.id);
    trierComptes(LIGNES, "nom");
    expect(LIGNES.map((l) => l.id)).toEqual(avant);
  });
});

describe("corps de requête", () => {
  it("action connue + motif d'au moins 5 caractères", () => {
    expect(corpsActionSchema.safeParse({ action: "suspendre", motif: "impayé depuis 2 mois" }).success).toBe(true);
    expect(corpsActionSchema.safeParse({ action: "retablir", motif: "régularisé" }).success).toBe(true);
    for (const corps of [{ action: "suspendre" }, { action: "suspendre", motif: "    " }, { action: "suspendre", motif: "abc" }, { action: "supprimer", motif: "motif valable" }, { motif: "motif valable" }, null, "x"]) {
      expect(corpsActionSchema.safeParse(corps).success, JSON.stringify(corps)).toBe(false);
    }
  });
  it("message de motif en français", () => {
    const r = corpsActionSchema.safeParse({ action: "suspendre", motif: "ab" });
    expect(!r.success && r.error.issues[0]?.message).toBe("Indiquez le motif (5 caractères au moins).");
  });
});

describe("verifierAction", () => {
  const sans = { organisationDuStaffId: null };
  it("organisation de démonstration : refusée pour toutes les actions", () => {
    for (const a of ["suspendre", "retablir", "revoquer", "terminer_essai"] as const) {
      const v = verifierAction(a, org({ is_demo: true, suspendue_le: jours(-1) }), sans, MAINTENANT);
      expect(v).toMatchObject({ ok: false, statut: 409, code: "ORGANISATION_DEMO" });
    }
  });
  it("suspendre : un compte actif seulement", () => {
    expect(verifierAction("suspendre", org(), sans, MAINTENANT)).toEqual({ ok: true });
    expect(verifierAction("suspendre", org({ suspendue_le: jours(-1) }), sans, MAINTENANT)).toMatchObject({ ok: false, code: "DEJA_SUSPENDU" });
  });
  it("rétablir : un compte suspendu seulement", () => {
    expect(verifierAction("retablir", org({ suspendue_le: jours(-1) }), sans, MAINTENANT)).toEqual({ ok: true });
    expect(verifierAction("retablir", org(), sans, MAINTENANT)).toMatchObject({ ok: false, code: "PAS_SUSPENDU" });
  });
  it("révoquer : accepté actif ou déjà suspendu", () => {
    expect(verifierAction("revoquer", org(), sans, MAINTENANT)).toEqual({ ok: true });
    expect(verifierAction("revoquer", org({ suspendue_le: jours(-1) }), sans, MAINTENANT)).toEqual({ ok: true });
  });
  it("terminer l'essai : essai GO en cours seulement", () => {
    expect(verifierAction("terminer_essai", org(), sans, MAINTENANT)).toEqual({ ok: true });
    expect(verifierAction("terminer_essai", org({ offre: null }), sans, MAINTENANT)).toMatchObject({ code: "PAS_UN_ESSAI_GO" });
    expect(verifierAction("terminer_essai", org({ subscription_status: "active" }), sans, MAINTENANT)).toMatchObject({ code: "DEJA_ABONNE" });
    expect(verifierAction("terminer_essai", org({ trial_ends_at: jours(-1) }), sans, MAINTENANT)).toMatchObject({ code: "ESSAI_DEJA_TERMINE" });
    expect(verifierAction("terminer_essai", org({ trial_ends_at: null }), sans, MAINTENANT)).toMatchObject({ code: "ESSAI_DEJA_TERMINE" });
  });
  it("organisation du staff : nom exact retapé exigé (sauf pour rétablir)", () => {
    const moi = { organisationDuStaffId: "o1" };
    for (const a of ["suspendre", "revoquer", "terminer_essai"] as const) {
      expect(verifierAction(a, org(), moi, MAINTENANT), a).toMatchObject({ ok: false, code: "CONFIRMATION_RENFORCEE" });
      expect(verifierAction(a, org(), { ...moi, confirmationNom: "mauvais nom" }, MAINTENANT), a).toMatchObject({ ok: false, code: "CONFIRMATION_RENFORCEE" });
      expect(verifierAction(a, org(), { ...moi, confirmationNom: "  GO Navigation – Jean Dupont " }, MAINTENANT), a).toEqual({ ok: true });
    }
    expect(verifierAction("retablir", org({ suspendue_le: jours(-1) }), moi, MAINTENANT)).toEqual({ ok: true });
  });
  it("une autre organisation que celle du staff n'exige pas la confirmation renforcée", () => {
    expect(verifierAction("suspendre", org({ id: "autre" }), { organisationDuStaffId: "o1" }, MAINTENANT)).toEqual({ ok: true });
  });
});

describe("actions proposées et textes", () => {
  it("selon l'état", () => {
    expect(actionsProposees(ligne({}))).toEqual(["suspendre", "revoquer", "terminer_essai"]);
    expect(actionsProposees(ligne({ statut: "essai_termine" }))).toEqual(["suspendre", "revoquer"]);
    expect(actionsProposees(ligne({ statut: "abonne", offre: "autre" }))).toEqual(["suspendre", "revoquer"]);
    expect(actionsProposees(ligne({ statut: "suspendu" }))).toEqual(["retablir", "revoquer"]);
    expect(actionsProposees(ligne({}), true)).toEqual([]);
  });
  it("les confirmations annoncent qu'aucune donnée n'est supprimée", () => {
    for (const a of ["suspendre", "revoquer"] as const) {
      const t = textesConfirmation(a, "Acme");
      expect(t.titre).toContain("Acme");
      expect(t.message).toContain("Aucune donnée n'est supprimée");
      expect(t.danger).toBe(true);
    }
    expect(textesConfirmation("retablir", "Acme").danger).toBe(false);
    expect(textesConfirmation("terminer_essai", "Acme").message).toContain("conservées");
  });
});
