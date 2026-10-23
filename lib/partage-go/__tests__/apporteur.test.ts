import { describe, expect, it } from "vitest";
import {
  MAX_CREATIONS_PAR_JOUR,
  MAX_INSCRIPTIONS_LIEN,
  VALIDITE_LIEN_APPORTEUR_JOURS,
  SANS_APPORTEUR,
  attributionDepuis,
  depasseMaxInscriptions,
  droitPartageGo,
  expirationLienApporteur,
  libelleApporteur,
  lienSms,
  lienUtilisable,
  lienWhatsapp,
  limiteCreationAtteinte,
  messagePartage,
  peutGererDroitsPartage,
  prenomDe,
  regrouperParApporteur,
  resumerStatuts,
  statutCompte,
  statutInvite,
  statutLien,
} from "@/lib/partage-go/apporteur";
import { deriverJetonApporteur, hacherJetonInvitation, ressembleJetonInvitation } from "@/lib/go-navigation/jeton";
import { DROIT_PARTAGE_GO, deciderAcces, ecran, ecransVisibles, horsOffreGoNavigation, MARQUEUR_GO_NAVIGATION, MODULES_AVEC_CODE } from "@/lib/acces/catalogue";
import { ECRANS_GO_NAVIGATION } from "@/lib/go-navigation/offre";

const MAINTENANT = new Date("2026-11-03T10:00:00Z");
const jours = (n: number) => new Date(MAINTENANT.getTime() + n * 86_400_000).toISOString();

describe("droit « Faire essayer GO »", () => {
  const base = { peutPartager: false, partageTous: false, offreGoNavigation: false };
  it("la direction l'a toujours", () => {
    expect(droitPartageGo({ ...base, role: "direction" })).toBe(true);
  });
  it("les autres rôles seulement s'ils sont désignés ou si toute l'équipe est ouverte", () => {
    for (const role of ["chauffeur", "manager", "exploitation", "comptable"]) {
      expect(droitPartageGo({ ...base, role })).toBe(false);
      expect(droitPartageGo({ ...base, role, peutPartager: true })).toBe(true);
      expect(droitPartageGo({ ...base, role, partageTous: true })).toBe(true);
    }
  });
  it("jamais pour un compte d'essai GO Navigation, même direction ou toute l'équipe", () => {
    expect(droitPartageGo({ ...base, role: "direction", offreGoNavigation: true })).toBe(false);
    expect(droitPartageGo({ ...base, role: "manager", partageTous: true, offreGoNavigation: true })).toBe(false);
  });
  it("seule la direction désigne les personnes", () => {
    expect(peutGererDroitsPartage("direction")).toBe(true);
    expect(peutGererDroitsPartage("exploitation")).toBe(false);
  });
});

describe("écran partage.go dans le catalogue", () => {
  const tous = new Set<string>(MODULES_AVEC_CODE);
  it("fermé à tous sans le droit, ouvert avec", () => {
    const e = ecran("partage.go");
    for (const role of ["chauffeur", "manager", "exploitation", "comptable", "direction"] as const) {
      expect(deciderAcces(e, role, tous, true).ok, role).toBe(false);
      expect(deciderAcces(e, role, new Set([...tous, DROIT_PARTAGE_GO]), true).ok, role).toBe(true);
    }
  });
  it("entrée de menu « Faire essayer GO » pour les personnes autorisées seulement", () => {
    const avec = new Set([...tous, DROIT_PARTAGE_GO]);
    expect(ecransVisibles("direction", avec).map((x) => x.libelle)).toContain("Faire essayer GO");
    expect(ecransVisibles("manager", avec, true).map((x) => x.libelle)).toContain("Faire essayer GO");
    expect(ecransVisibles("direction", tous).map((x) => x.libelle)).not.toContain("Faire essayer GO");
  });
  it("jamais ouvert aux comptes d'essai GO Navigation (ECRANS_GO_NAVIGATION inchangé)", () => {
    expect(ECRANS_GO_NAVIGATION).not.toContain("partage.go");
    const essai = new Set(["route_optimizer", "mobile_app", "alerts", "auth_onboarding", MARQUEUR_GO_NAVIGATION, DROIT_PARTAGE_GO]);
    expect(horsOffreGoNavigation("partage.go", essai)).toBe(true);
    expect(ecransVisibles("manager", essai, true).map((x) => x.id)).not.toContain("partage.go");
  });
});

describe("limites", () => {
  it("10 créations par jour", () => {
    expect(MAX_CREATIONS_PAR_JOUR).toBe(10);
    expect(limiteCreationAtteinte(9)).toBe(false);
    expect(limiteCreationAtteinte(10)).toBe(true);
  });
  it("lien valable 90 jours, 20 inscriptions", () => {
    expect(VALIDITE_LIEN_APPORTEUR_JOURS).toBe(90);
    expect(MAX_INSCRIPTIONS_LIEN).toBe(20);
    expect(expirationLienApporteur(MAINTENANT).toISOString()).toBe(jours(90));
  });
  it("dépassement du maximum après réservation", () => {
    expect(depasseMaxInscriptions(20, 20)).toBe(false);
    expect(depasseMaxInscriptions(21, 20)).toBe(true);
  });
});

describe("statut du lien personnel", () => {
  const lien = { expires_at: jours(30), revoked_at: null, max_inscriptions: 3 };
  it("actif, complet, expiré, révoqué", () => {
    expect(statutLien(lien, 0, MAINTENANT)).toBe("actif");
    expect(statutLien(lien, 3, MAINTENANT)).toBe("complet");
    expect(statutLien({ ...lien, expires_at: jours(-1) }, 0, MAINTENANT)).toBe("expire");
    expect(statutLien({ ...lien, revoked_at: jours(-2) }, 0, MAINTENANT)).toBe("revoque");
  });
  it("utilisable seulement s'il est actif", () => {
    expect(lienUtilisable(lien, 2, MAINTENANT)).toBe(true);
    expect(lienUtilisable(lien, 3, MAINTENANT)).toBe(false);
    expect(lienUtilisable(null, 0, MAINTENANT)).toBe(false);
  });
});

describe("attribution posée depuis le jeton", () => {
  it("invitation du staff : aucun apporteur", () => {
    expect(attributionDepuis({ created_by_user_id: null, created_by_org_id: null, referral_link_id: null })).toEqual(SANS_APPORTEUR);
    expect(attributionDepuis(null)).toEqual(SANS_APPORTEUR);
    expect(attributionDepuis(undefined)).toEqual(SANS_APPORTEUR);
  });
  it("invitation d'un apporteur : personne et organisation, sans lien", () => {
    expect(attributionDepuis({ created_by_user_id: "u1", created_by_org_id: "o1", referral_link_id: null })).toEqual({ referred_by_user_id: "u1", referred_by_org_id: "o1", referral_link_id: null });
  });
  it("lien personnel : personne, organisation et lien", () => {
    expect(attributionDepuis({ created_by_user_id: "u1", created_by_org_id: "o1", referral_link_id: "l1" })).toEqual({ referred_by_user_id: "u1", referred_by_org_id: "o1", referral_link_id: "l1" });
  });
  it("tout ou rien : un apporteur sans organisation n'est pas retenu", () => {
    expect(attributionDepuis({ created_by_user_id: "u1", created_by_org_id: null })).toEqual(SANS_APPORTEUR);
  });
});

describe("statuts d'un invité", () => {
  const envoyee = { expires_at: jours(10), used_at: null, revoked_at: null };
  const utilisee = { ...envoyee, used_at: jours(-1) };
  it("envoyée, expirée, révoquée", () => {
    expect(statutInvite(envoyee, null, MAINTENANT)).toBe("envoyee");
    expect(statutInvite({ ...envoyee, expires_at: jours(-1) }, null, MAINTENANT)).toBe("expiree");
    expect(statutInvite({ ...envoyee, revoked_at: jours(-1) }, null, MAINTENANT)).toBe("revoquee");
  });
  it("essai en cours, essai terminé, abonnée", () => {
    expect(statutInvite(utilisee, { subscription_status: "trialing", trial_ends_at: jours(20) }, MAINTENANT)).toBe("essai_en_cours");
    expect(statutInvite(utilisee, { subscription_status: "trialing", trial_ends_at: jours(-1) }, MAINTENANT)).toBe("essai_termine");
    expect(statutInvite(utilisee, { subscription_status: "active", trial_ends_at: jours(-1) }, MAINTENANT)).toBe("abonnee");
    expect(statutInvite(utilisee, { subscription_status: "trialing", trial_ends_at: null }, MAINTENANT)).toBe("essai_termine");
  });
  it("une invitation utilisée le reste, même révoquée ou expirée ensuite", () => {
    expect(statutInvite({ ...utilisee, revoked_at: jours(-1), expires_at: jours(-1) }, { trial_ends_at: jours(5) }, MAINTENANT)).toBe("essai_en_cours");
  });
  it("organisation illisible : essai en cours", () => {
    expect(statutInvite(utilisee, null, MAINTENANT)).toBe("essai_en_cours");
  });
  it("statut d'un compte d'essai : client payant = abonnement actif", () => {
    expect(statutCompte({ subscription_status: "active" }, MAINTENANT)).toBe("abonnee");
    expect(statutCompte({ subscription_status: "canceled", trial_ends_at: jours(3) }, MAINTENANT)).toBe("essai_en_cours");
  });
});

describe("synthèse par apporteur", () => {
  it("compte les comptes créés seulement (pas les invitations en attente)", () => {
    expect(resumerStatuts(["envoyee", "expiree", "revoquee", "essai_en_cours", "essai_termine", "abonnee"])).toEqual({ inscrits: 3, essaisEnCours: 1, essaisTermines: 1, abonnes: 1 });
  });
  it("regroupe par apporteur, le plus d'inscrits d'abord", () => {
    const r = regrouperParApporteur([
      { apporteurId: "a", apporteurNom: "Alice", statut: "essai_en_cours" },
      { apporteurId: "b", apporteurNom: "Bruno", statut: "abonnee" },
      { apporteurId: "b", apporteurNom: "Bruno", statut: "essai_termine" },
      { apporteurId: "a", apporteurNom: "Alice", statut: "envoyee" },
    ]);
    expect(r.map((x) => [x.nom, x.inscrits, x.essaisEnCours, x.abonnes])).toEqual([
      ["Bruno", 2, 0, 1],
      ["Alice", 1, 1, 0],
    ]);
  });
});

describe("libellés et partage", () => {
  it("« Invité par » : nom, sinon organisation, jamais d'e-mail", () => {
    expect(libelleApporteur("  Jean   Dupont ", "Transports Exemple")).toBe("Jean Dupont");
    expect(libelleApporteur(null, "Transports Exemple")).toBe("Transports Exemple");
    expect(libelleApporteur("jean@exemple.fr", "Transports Exemple")).toBe("Transports Exemple");
    expect(libelleApporteur("jean@exemple.fr", "contact@exemple.fr")).toBeNull();
    expect(libelleApporteur("", "")).toBeNull();
  });
  it("prénom pour le message", () => {
    expect(prenomDe("Jean Dupont")).toBe("Jean");
    expect(prenomDe("jean@exemple.fr")).toBeNull();
    expect(prenomDe(null)).toBeNull();
  });
  it("message court en français et liens SMS / WhatsApp encodés", () => {
    const url = "https://exemple.fr/go-navigation/abc";
    const m = messagePartage(url, "Jean");
    expect(m).toContain("de la part de Jean");
    expect(m).toContain(url);
    expect(messagePartage(url)).not.toContain("de la part");
    expect(lienSms(m)).toBe(`sms:?&body=${encodeURIComponent(m)}`);
    expect(lienWhatsapp(m)).toBe(`https://wa.me/?text=${encodeURIComponent(m)}`);
  });
});

describe("jeton du lien personnel", () => {
  it("dérivé de l'id : stable, de la bonne forme, propre à chaque lien et à chaque secret", () => {
    const a = deriverJetonApporteur("11111111-1111-1111-1111-111111111111", "secret-de-test");
    expect(ressembleJetonInvitation(a)).toBe(true);
    expect(deriverJetonApporteur("11111111-1111-1111-1111-111111111111", "secret-de-test")).toBe(a);
    expect(deriverJetonApporteur("22222222-2222-2222-2222-222222222222", "secret-de-test")).not.toBe(a);
    expect(deriverJetonApporteur("11111111-1111-1111-1111-111111111111", "autre-secret")).not.toBe(a);
    expect(hacherJetonInvitation(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
